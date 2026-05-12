// =============================================================================
// vitest.config.ts (apps/api) — NestJS test config
// =============================================================================
// - `globals: true` → describe/it/expect/vi accessibili senza import (idiomatic)
// - `environment: 'node'` → no jsdom (siamo backend)
// - `setupFiles` → placeholder per future global mocks/fixtures
// - Match pattern: *.spec.ts in src/ (co-locazione con codice testato)
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@gestionale/api',
    globals: true,
    environment: 'node',
    root: './',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['./test/setup.ts'],
  },
});
