// =============================================================================
// test/setup.ts — Global setup per Vitest in apps/restaurant-api (project `unit`)
// =============================================================================
// Vitest carica questo file una volta prima di qualsiasi test file unit.
//
// reflect-metadata: necessario per gli unit test che importano DTO con
// decorator class-transformer `@Type()` / class-validator `@IsEnum()` ecc.
// — questi chiamano `Reflect.getMetadata` a class-definition time. Il project
// `e2e` lo carica via `test/e2e/setup-env.ts`; il project `unit` ha il suo
// gate qui (TD-BS Sub-1, sessione 18 — validation unit test co-located).
// =============================================================================

import 'reflect-metadata';

// Nessuna global mock attualmente necessaria. I test mock vi.fn() i providers
// NestJS individuali via Test.createTestingModule().
