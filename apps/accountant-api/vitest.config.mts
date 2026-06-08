// =============================================================================
// vitest.config.mts (apps/accountant-api) — projects unit + e2e
// =============================================================================
// 2 progetti separati (pattern restaurant-api):
//   - unit (`pnpm test`):     src/**/*.spec.ts, FAST, no infrastruttura (DTO).
//   - e2e  (`pnpm test:e2e`): test/e2e/**/*.e2e-spec.ts, SLOW, Testcontainers
//     Postgres/Redis (STOP-c1b). Solo locale (TD-CB: non in CI, come restaurant-api).
//
// SWC plugin: emette emitDecoratorMetadata (esbuild di Vitest non lo fa) —
// critico per il bootstrap DI dell'AppModule in e2e (design:paramtypes).
// keepClassNames per i token IoC NestJS.
// =============================================================================

import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
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
        // ─── E2E (STOP-c1b) — Testcontainers per-file, no shared globale ──────
        // setupFiles=setup-env.ts: env vars validate top-level dai moduli NestJS
        // (JWT_SECRET in auth.module.ts). createTestApp override in beforeAll.
        test: {
          name: 'e2e',
          globals: true,
          environment: 'node',
          root: './',
          include: ['test/e2e/**/*.e2e-spec.ts'],
          setupFiles: ['./test/e2e/setup-env.ts'],
          testTimeout: 60_000, // container ops + migrate + test
          hookTimeout: 90_000, // beforeAll = Testcontainers + Prisma migrate
        },
      },
    ],
  },
});
