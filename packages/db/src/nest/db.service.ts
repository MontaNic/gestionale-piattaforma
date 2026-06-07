// =============================================================================
// db.service.ts — Wrapper NestJS-friendly del Prisma client extended
// =============================================================================
// Composition (non inheritance): espone `prisma` come property. Lifecycle:
// - onModuleInit:    $connect eager -> pool TCP pronta prima della prima query
// - onModuleDestroy: $disconnect graceful -> shutdown pulito
//
// Importa il singleton `prisma` da @gestionale/db (gia' extended con
// softDeleteExtension). Use case typical:
//
//   @Injectable()
//   class SomeService {
//     constructor(private readonly db: DbService) {}
//     async find() { return this.db.prisma.tenant.findMany(); }
//   }
//
// Vedi ADR-0007 decisione E per scelta composition vs inheritance.
// =============================================================================

import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { prisma, type ExtendedPrismaClient } from '@gestionale/db';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);

  readonly prisma: ExtendedPrismaClient = prisma;

  async onModuleInit(): Promise<void> {
    await this.prisma.$connect();
    this.logger.log('Prisma connected to PostgreSQL');
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
    this.logger.log('Prisma disconnected');
  }
}
