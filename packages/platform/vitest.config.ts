import { defineConfig } from 'vitest/config';

// Unit test del package platform (node env). Gli spec viaggiano col codice
// estratto (ADR-0027 §D5 passo 6): throttler util/skipIf + prisma-errors.
// `.spec.ts` mirror del naming usato in apps/restaurant-api (non `.test.ts` di shared).
export default defineConfig({
  test: {
    name: 'platform',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
