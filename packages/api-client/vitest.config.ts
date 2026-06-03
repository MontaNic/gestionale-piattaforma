import { defineConfig } from 'vitest/config';

// Test del client HTTP (ADR-0027 §D5 passo 5a: chiude il gap "api.ts senza test").
// Esercita la public surface (apiGet/apiPost/...) con `fetch` globale mockato →
// env node (Node 20 fornisce fetch/Response/Headers globali), nessun DOM.
export default defineConfig({
  test: {
    name: 'api-client',
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
