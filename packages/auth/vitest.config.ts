import { defineConfig } from 'vitest/config';

// Unit test del package auth (node env). Gli spec viaggiano col codice estratto
// (ADR-0027 §D5 passo 7): auth.service, lockout, permissions.guard,
// require-permissions.decorator, users.service.
// `.spec.ts` mirror del naming usato in apps/restaurant-api (non `.test.ts` di shared).
export default defineConfig({
  test: {
    name: 'auth',
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
