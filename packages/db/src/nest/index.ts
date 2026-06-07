// =============================================================================
// @gestionale/db/nest — sub-entry NestJS-aware del data layer
// =============================================================================
// Espone DbService (wrapper lifecycle Prisma) + DbModule (@Global provider).
// Vive SOLO qui: l'entry principale `.` resta agnostico verso @nestjs/* — i
// consumer non-NestJS importano `@gestionale/db`, i moduli Nest `@gestionale/db/nest`.
//
// CRITICO (singolo pool): DbService importa `prisma` da '@gestionale/db' come
// self-reference (mai relativo). Con '@gestionale/db' in `external` di tsup,
// a runtime questo bundle fa `require('@gestionale/db')` e risolve all'entry `.`
// = una sola istanza del singleton. Vedi ADR-0007 + STOP 0.5 probe.
// =============================================================================

export { DbService } from './db.service';
export { DbModule } from './db.module';
