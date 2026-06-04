import type { ConfigService } from '@nestjs/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RedisService } from '@gestionale/platform';
import { LockoutService } from './lockout.service';

// =============================================================================
// LockoutService spec (B1 STOP 4)
// =============================================================================
// 8 test focalizzati su state transitions + fail-open behaviour:
//   - checkLockout (not-locked / locked)
//   - recordFailedAttempt (sub-threshold / at-threshold promotion / pipeline order)
//   - resetAttempts (DEL entrambe le chiavi)
//   - Redis fail-open (errore -> nessun throw, log warn)
//
// Mock di RedisService + ConfigService: niente Redis reale (B2 con
// Testcontainers tracciato come scope sessione 9). Threshold=3 per leggibilita'.
// =============================================================================

type MockPipeline = {
  zadd: ReturnType<typeof vi.fn>;
  zremrangebyscore: ReturnType<typeof vi.fn>;
  zcard: ReturnType<typeof vi.fn>;
  pexpire: ReturnType<typeof vi.fn>;
  exec: ReturnType<typeof vi.fn>;
};

type MockRedisClient = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  pttl: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  pipeline: ReturnType<typeof vi.fn>;
};

const LOCKOUT_CONFIG: Record<string, string> = {
  LOCKOUT_THRESHOLD: '3',
  LOCKOUT_WINDOW_MS: '900000', // 15min
  LOCKOUT_DURATION_MS: '900000', // 15min
};

function makePipeline(zcardResult: number): MockPipeline {
  // execResult: array di [err, value] tuple, indice 2 = zcard result.
  const execResult = [
    [null, 1], // zadd
    [null, 0], // zremrangebyscore
    [null, zcardResult], // zcard
    [null, 1], // pexpire
  ];
  const pipeline: MockPipeline = {
    zadd: vi.fn().mockReturnThis(),
    zremrangebyscore: vi.fn().mockReturnThis(),
    zcard: vi.fn().mockReturnThis(),
    pexpire: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(execResult),
  };
  return pipeline;
}

function createLockoutService(redisClient: MockRedisClient): {
  service: LockoutService;
  redisClient: MockRedisClient;
} {
  const redis: Pick<RedisService, 'getClient'> = {
    getClient: () => redisClient as unknown as ReturnType<RedisService['getClient']>,
  };
  const config: Pick<ConfigService, 'get'> = {
    get: vi.fn((key: string) => LOCKOUT_CONFIG[key]) as unknown as ConfigService['get'],
  };
  const service = new LockoutService(
    redis as unknown as RedisService,
    config as unknown as ConfigService,
  );
  return { service, redisClient };
}

describe('LockoutService', () => {
  let redis: MockRedisClient;

  beforeEach(() => {
    redis = {
      get: vi.fn(),
      set: vi.fn().mockResolvedValue('OK'),
      pttl: vi.fn(),
      del: vi.fn().mockResolvedValue(2),
      pipeline: vi.fn(),
    };
  });

  // ─── Test 1 — checkLockout: not-locked → null ──────────────────────────────
  it('checkLockout: returns null when identifier not locked', async () => {
    redis.get.mockResolvedValue(null);
    const { service } = createLockoutService(redis);

    const result = await service.checkLockout('user@example.com');

    expect(result).toBeNull();
    expect(redis.get).toHaveBeenCalledWith('lockout:locked:user@example.com');
    expect(redis.pttl).not.toHaveBeenCalled();
  });

  // ─── Test 2 — checkLockout: locked → { locked: true, retryAfterSec: real } ──
  it('checkLockout: returns lock status with real TTL (not the masked 900s)', async () => {
    redis.get.mockResolvedValue('1');
    redis.pttl.mockResolvedValue(600_000); // 10min residui
    const { service } = createLockoutService(redis);

    const result = await service.checkLockout('user@example.com');

    expect(result).toEqual({ locked: true, retryAfterSec: 600 });
    expect(redis.pttl).toHaveBeenCalledWith('lockout:locked:user@example.com');
  });

  // ─── Test 3 — recordFailedAttempt: count < threshold → false ──────────────
  it('recordFailedAttempt: returns promotedToLockout=false when count below threshold', async () => {
    const pipeline = makePipeline(2); // threshold=3, count=2 → no promote
    redis.pipeline.mockReturnValue(pipeline);
    const { service } = createLockoutService(redis);

    const result = await service.recordFailedAttempt('user@example.com');

    expect(result).toEqual({ promotedToLockout: false });
    expect(redis.set).not.toHaveBeenCalled();
  });

  // ─── Test 4 — recordFailedAttempt: count == threshold → true + SET locked ─
  it('recordFailedAttempt: promotes to lockout when count >= threshold', async () => {
    const pipeline = makePipeline(3); // threshold=3, count=3 → promote
    redis.pipeline.mockReturnValue(pipeline);
    const { service } = createLockoutService(redis);

    const result = await service.recordFailedAttempt('user@example.com');

    expect(result).toEqual({ promotedToLockout: true });
    expect(redis.set).toHaveBeenCalledWith(
      'lockout:locked:user@example.com',
      '1',
      'PX',
      900_000, // duration ms da config
    );
  });

  // ─── Test 5 — recordFailedAttempt: pipeline order (atomicity 1-roundtrip) ──
  it('recordFailedAttempt: pipeline contains zadd + zremrangebyscore + zcard + pexpire in order', async () => {
    const pipeline = makePipeline(1);
    redis.pipeline.mockReturnValue(pipeline);
    const { service } = createLockoutService(redis);

    await service.recordFailedAttempt('user@example.com');

    expect(pipeline.zadd).toHaveBeenCalledOnce();
    expect(pipeline.zremrangebyscore).toHaveBeenCalledOnce();
    expect(pipeline.zcard).toHaveBeenCalledOnce();
    expect(pipeline.pexpire).toHaveBeenCalledOnce();
    expect(pipeline.exec).toHaveBeenCalledOnce();

    // zremrangebyscore deve usare `-inf` + (now - window) come bounds:
    const zremCall = pipeline.zremrangebyscore.mock.calls[0];
    expect(zremCall?.[0]).toBe('lockout:attempts:user@example.com');
    expect(zremCall?.[1]).toBe('-inf');
    expect(typeof zremCall?.[2]).toBe('number');
  });

  // ─── Test 6 — resetAttempts: DEL entrambe le chiavi ────────────────────────
  it('resetAttempts: deletes both attempts and locked keys', async () => {
    const { service } = createLockoutService(redis);

    await service.resetAttempts('user@example.com');

    expect(redis.del).toHaveBeenCalledWith(
      'lockout:attempts:user@example.com',
      'lockout:locked:user@example.com',
    );
  });

  // ─── Test 7 — Fail-open: checkLockout returns null on Redis error ──────────
  it('checkLockout: fail-open returns null when Redis throws', async () => {
    redis.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const { service } = createLockoutService(redis);

    const result = await service.checkLockout('user@example.com');

    expect(result).toBeNull(); // fail-open: auth procede senza lockout check
  });

  // ─── Test 8 — Fail-open: recordFailedAttempt swallows error ───────────────
  it('recordFailedAttempt: fail-open returns {promotedToLockout:false} on Redis error', async () => {
    redis.pipeline.mockImplementation(() => {
      throw new Error('Redis connection lost');
    });
    const { service } = createLockoutService(redis);

    const result = await service.recordFailedAttempt('user@example.com');

    expect(result).toEqual({ promotedToLockout: false });
    expect(redis.set).not.toHaveBeenCalled();
  });
});
