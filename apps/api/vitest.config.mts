// =============================================================================
// vitest.config.mts (apps/api) — Vitest projects array (B2b)
// =============================================================================
// 2 progetti separati:
//   - unit (default `pnpm test`): src/**/*.spec.ts, FAST, no infrastruttura
//   - e2e  (`pnpm test:e2e`):       test/e2e/**/*.e2e-spec.ts, SLOW, Testcontainers
//
// Pattern `projects` array Vitest 4-ready API moderna (gia' usato in root
// vitest.config.mts da D2-vitest). `name` per filtraggio runtime via
// `vitest run --project=unit|e2e`.
//
// Timeout estesi nel project e2e: container Postgres+Redis startup tipico
// ~10-15s + Prisma migrate ~3-5s. hookTimeout 90s copre beforeAll completo.
// =============================================================================

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC plugin emette emitDecoratorMetadata (Vitest+esbuild non lo fa nativamente,
// problema noto B1 STOP 4 unit test). Richiesto SOLO per E2E full Nest bootstrap
// (Test.createTestingModule(AppModule) DI risolve types via reflection metadata).
// I unit test esistenti usano manual instantiation (bypass DI) → no impatto.
// Discovery #29 B2b — workaround NestJS-idiomatic raccomandato in docs ufficiali.

export default defineConfig({
  plugins: [
    swc.vite({
      // Discovery #29 B2b: config inline (ridondante con apps/api/.swcrc
      // perche' unplugin-swc cerca .swcrc da Vitest cwd root, NON da
      // apps/api). Config esplicito + tsconfigFile: false evita merge confuso.
      //
      // keepClassNames: true ⭐ critical NestJS DI (no class renaming →
      //   il token registrato in IoC corrisponde a quello cercato via
      //   design:paramtypes).
      // decoratorMetadata + legacyDecorator → emit Stage 1 decorators
      //   + Reflect.metadata('design:paramtypes', ...).
      // module.type: commonjs → apps/api CJS (ADR-0007 CC2), runtime allineato.
      tsconfigFile: false,
      sourceMaps: true,
      jsc: {
        parser: {
          syntax: 'typescript',
          decorators: true,
          dynamicImport: true,
        },
        transform: {
          legacyDecorator: true,
          decoratorMetadata: true,
        },
        keepClassNames: true,
        target: 'es2022',
      },
      module: {
        type: 'commonjs',
      },
    }),
  ],
  test: {
    projects: [
      {
        // ─── Unit tests (esistenti, src/**/*.spec.ts) ─────────────────────────
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          root: './',
          include: ['src/**/*.spec.ts'],
          setupFiles: ['./test/setup.ts'],
        },
      },
      {
        // ─── E2E tests (B2b, NEW) ─────────────────────────────────────────────
        // Container start in beforeAll, app.close + container.stop in afterAll.
        // Per-file containers (no shared globale) per isolamento totale.
        //
        // setupFiles include `setup-env.ts` per env vars validate top-level dai
        // moduli NestJS (es. JWT_SECRET in auth.module.ts — Discovery #28 B2b).
        // createTestApp in beforeAll override valori container-specifici.
        test: {
          name: 'e2e',
          globals: true,
          environment: 'node',
          root: './',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          setupFiles: ['./test/e2e/setup-env.ts'],
          testTimeout: 60_000, // container ops + migrate + test execution
          hookTimeout: 90_000, // beforeAll = Testcontainers + Prisma migrate
        },
      },
    ],
  },
});
