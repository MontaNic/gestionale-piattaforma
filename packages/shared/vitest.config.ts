import { defineConfig } from 'vitest/config';

// Test puri (node env): parità/forma della tassonomia error-code agnostica.
export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
