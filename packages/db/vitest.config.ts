import { defineConfig } from 'vitest/config';

// Test puri (node env) per @gestionale/db. Niente connessione DB: i test
// verificano solo contratti/identità di oggetti (es. il seam fase 1
// `getClientForTenant`). Il singleton `prisma` istanzia `new PrismaClient()`
// al require-time (Discovery #30) e richiede `DATABASE_URL`: forniamo URL
// fittizie — Prisma costruisce il client ma NON apre connessioni (lazy) finché
// non parte una query, che questi test non eseguono.
export default defineConfig({
  test: {
    name: 'db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      DIRECT_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
    },
  },
});
