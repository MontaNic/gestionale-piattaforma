import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Smoke test di render del design system (ADR-0027 §D5 passo 2: chiude il gap
// "il design system non ha test propri"). jsdom + Testing Library coprono anche
// i componenti Radix (Dialog) che richiedono un DOM reale.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'ui',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
