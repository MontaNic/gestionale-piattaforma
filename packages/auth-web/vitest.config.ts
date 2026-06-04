import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Test dell'auth FE (ADR-0027 §D5 passo 5b: chiude il gap "AuthContext/AuthGate
// senza test propri"). jsdom + Testing Library coprono i client component
// (provider che monta + fetch /me, AuthGate redirect) e il token storage che
// legge/scrive localStorage.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'auth-web',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
