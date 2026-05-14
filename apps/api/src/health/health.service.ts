import { Inject, Injectable, Logger } from '@nestjs/common';
import { withSystemContext } from '@gestionale/db';

import { DbService } from '../db/db.service';
import type { HealthDto } from './health.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(@Inject(DbService) private readonly db: DbService) {}

  async check(): Promise<HealthDto> {
    const timestamp = new Date().toISOString();
    try {
      // $queryRaw bypassa l'extension RLS (intercetta solo model operations),
      // ma wrappa in withSystemContext per:
      // (a) coerenza con le altre code path che dichiarano intent esplicito
      // (b) safety se in futuro l'extension RLS coprira' anche $queryRaw
      // (c) leggibilita': il health check e' system context per design.
      // Niente PII letta, solo connection ping.
      await withSystemContext(() => this.db.prisma.$queryRaw`SELECT 1`);
      return { status: 'ok', db: 'connected', timestamp };
    } catch (err) {
      this.logger.error('Healthcheck DB ping failed', err instanceof Error ? err.stack : err);
      return {
        status: 'degraded',
        db: 'unreachable',
        timestamp,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }
}
