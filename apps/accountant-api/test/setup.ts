// =============================================================================
// test/setup.ts — Global setup per Vitest in apps/accountant-api (project `unit`)
// =============================================================================
// Caricato una volta prima dei test unit. reflect-metadata serve ai DTO con
// decorator class-validator (`@IsEnum` ecc.) che leggono Reflect a
// class-definition time (TD-BS Sub-1). Mirror di apps/restaurant-api/test/setup.ts.
// =============================================================================

import 'reflect-metadata';
