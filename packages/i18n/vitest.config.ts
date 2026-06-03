import { defineConfig } from 'vitest/config';

// Test del meccanismo i18n (ADR-0027 §D5 passo 4: chiude il gap "switch locale e
// fallback non testati a unità"). Solo logica pura (resolve.ts/config.ts) → env
// node, nessun DOM né dipendenza runtime da Next.
export default defineConfig({
  test: {
    name: 'i18n',
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
