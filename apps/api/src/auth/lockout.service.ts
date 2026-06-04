import crypto from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RedisService } from '@gestionale/platform';

// =============================================================================
// LockoutService — Redis sliding window + auto-promotion a lockout (B1 fase 3)
// =============================================================================
// Pattern (decisione Claude strategico, lockata STOP 3):
//
//   - Chiavi Redis:
//       * lockout:attempts:<id>  (Sorted Set, ZADD timestamp_ms)
//       * lockout:locked:<id>    (string, TTL = LOCKOUT_DURATION_SEC)
//   - recordFailedAttempt:
//       1. ZADD timestamp_ms now → member univoco
//       2. ZREMRANGEBYSCORE rimuove attempt fuori finestra (sliding window)
//       3. ZCARD count → se >= threshold, SET lockout:locked:<id> con TTL
//       4. EXPIRE su lockout:attempts:<id> = window per auto-cleanup
//   - checkLockout:
//       1. GET lockout:locked:<id> → null se non bloccato
//       2. Se presente, PTTL per retryAfterSec residuo (debug, NON esposto al client)
//   - resetAttempts: DEL entrambe le chiavi (su login.success)
//
// Dev-tolerant: errori Redis NON bloccano l'auth.
//   * checkLockout fail → ritorna null (fail-open) + log warn
//   * recordFailedAttempt fail → ritorna {promotedToLockout: false} + log warn
//   * resetAttempts fail → log warn (success login non viene comunque bloccato)
// Rationale: rate limiting via Throttler (B1 fase 1-2) è il primo strato di
// difesa; lockout è secondo strato. Redis down ≠ porta aperta agli attacker
// → auth continua a funzionare ma senza lockout finche' Redis si riprende.
// Production: monitoring Redis health + alert (vedi ADR-0013 TD-B).
//
// Privacy log: identifier hashato sha256 first 8 char ("a3b4c5d6") nei log,
// MAI plaintext (email/deviceId). Le chiavi Redis usano l'identifier raw
// (efficienza lookup; Redis non e' pubblicamente accessibile).
// =============================================================================

const ATTEMPTS_KEY_PREFIX = 'lockout:attempts:';
const LOCKED_KEY_PREFIX = 'lockout:locked:';

const DEFAULT_THRESHOLD = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 min
const DEFAULT_DURATION_MS = 15 * 60 * 1000; // 15 min

export interface LockoutStatus {
  locked: true;
  /** Tempo residuo reale del lockout in DB Redis. NON esporre tale-quale al
   * client (anti user-enumeration TD-J): il controller filter mette sempre 900. */
  retryAfterSec: number;
}

@Injectable()
export class LockoutService {
  private readonly log = new Logger(LockoutService.name);
  private readonly threshold: number;
  private readonly windowMs: number;
  private readonly durationMs: number;

  // @Inject esplicito (vedi RedisService — Discovery #29 B2b).
  constructor(
    @Inject(RedisService) private readonly redis: RedisService,
    @Inject(ConfigService) config: ConfigService,
  ) {
    this.threshold = Number(config.get<string>('LOCKOUT_THRESHOLD') ?? String(DEFAULT_THRESHOLD));
    this.windowMs = Number(config.get<string>('LOCKOUT_WINDOW_MS') ?? String(DEFAULT_WINDOW_MS));
    this.durationMs = Number(
      config.get<string>('LOCKOUT_DURATION_MS') ?? String(DEFAULT_DURATION_MS),
    );
  }

  async checkLockout(identifier: string): Promise<LockoutStatus | null> {
    const lockedKey = `${LOCKED_KEY_PREFIX}${identifier}`;
    try {
      const client = this.redis.getClient();
      const value = await client.get(lockedKey);
      if (!value) return null;
      const pttl = await client.pttl(lockedKey);
      const retryAfterSec = pttl > 0 ? Math.ceil(pttl / 1000) : Math.ceil(this.durationMs / 1000);
      this.log.log(
        `action=check identifier=${this.hashId(identifier)} locked=true retryAfterSec=${retryAfterSec}`,
      );
      return { locked: true, retryAfterSec };
    } catch (err) {
      this.log.warn(
        `Redis unavailable in checkLockout (fail-open) for id=${this.hashId(identifier)}: ${this.errMsg(err)}`,
      );
      return null;
    }
  }

  async recordFailedAttempt(identifier: string): Promise<{ promotedToLockout: boolean }> {
    const attemptsKey = `${ATTEMPTS_KEY_PREFIX}${identifier}`;
    const lockedKey = `${LOCKED_KEY_PREFIX}${identifier}`;
    const now = Date.now();
    try {
      const client = this.redis.getClient();
      const member = `${now}-${crypto.randomBytes(4).toString('hex')}`;
      const pipeline = client.pipeline();
      pipeline.zadd(attemptsKey, now, member);
      pipeline.zremrangebyscore(attemptsKey, '-inf', now - this.windowMs);
      pipeline.zcard(attemptsKey);
      pipeline.pexpire(attemptsKey, this.windowMs);
      const results = await pipeline.exec();
      const zcardResult = results?.[2];
      const count =
        Array.isArray(zcardResult) && typeof zcardResult[1] === 'number' ? zcardResult[1] : 0;

      let promotedToLockout = false;
      if (count >= this.threshold) {
        await client.set(lockedKey, '1', 'PX', this.durationMs);
        promotedToLockout = true;
      }

      this.log.log(
        `action=record identifier=${this.hashId(identifier)} count=${count} threshold=${this.threshold} promoted=${promotedToLockout}`,
      );
      return { promotedToLockout };
    } catch (err) {
      this.log.warn(
        `Redis unavailable in recordFailedAttempt for id=${this.hashId(identifier)}: ${this.errMsg(err)}`,
      );
      return { promotedToLockout: false };
    }
  }

  async resetAttempts(identifier: string): Promise<void> {
    const attemptsKey = `${ATTEMPTS_KEY_PREFIX}${identifier}`;
    const lockedKey = `${LOCKED_KEY_PREFIX}${identifier}`;
    try {
      const client = this.redis.getClient();
      await client.del(attemptsKey, lockedKey);
      this.log.log(`action=reset identifier=${this.hashId(identifier)}`);
    } catch (err) {
      this.log.warn(
        `Redis unavailable in resetAttempts for id=${this.hashId(identifier)}: ${this.errMsg(err)}`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers privati
  // ---------------------------------------------------------------------------

  private hashId(identifier: string): string {
    // sha256 truncata a 8 hex char → privacy preservation nei log.
    return crypto.createHash('sha256').update(identifier).digest('hex').slice(0, 8);
  }

  private errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
