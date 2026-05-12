import { Injectable, Logger } from '@nestjs/common';

import { DbService } from '../db/db.service';
import type { HealthDto } from './health.dto';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly db: DbService) {}

  async check(): Promise<HealthDto> {
    const timestamp = new Date().toISOString();
    try {
      // $queryRaw bypass policy RLS attive: serve solo a verificare che la
      // connessione TCP + auth Postgres sia healthy. Niente PII letta.
      await this.db.prisma.$queryRaw`SELECT 1`;
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
