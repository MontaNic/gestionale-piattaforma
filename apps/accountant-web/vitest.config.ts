import { defineConfig } from 'vitest/config';

// =============================================================================
// vitest.config.ts (accountant-web) — Gate unit FE (STOP-e2 ADR-0037 §test)
// =============================================================================
// Primo gate unit del verticale web commercialisti. Copre il mirror della
// formula totali (preventivi-totali) che DEVE coincidere col server: funzione
// pura → env node, nessun DOM. Tests `.tsx` (component) arriveranno con jsdom +
// Testing Library quando serviranno (pattern auth-web).
// =============================================================================

export default defineConfig({
  test: {
    name: 'accountant-web',
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
