// =============================================================================
// vitest.config.mts (root) — aggregatore locale via `projects` (Vitest 3+)
// =============================================================================
// NON e' il percorso della CI. `pnpm test` esegue `turbo run test`, che invoca
// lo script `test` di CIASCUN workspace con il SUO config: questo file serve
// solo a chi lancia `vitest` dalla radice per vedere tutto insieme.
//
// Elenco tenuto alla LANE VELOCE: solo progetti unit, nessuna infrastruttura.
// `apps/accountant-api/vitest.config.mts` e' escluso di proposito — dichiara due
// progetti (unit + e2e) e l'e2e avvia Testcontainers Postgres/Redis: includerlo
// trasformerebbe un `vitest` dalla radice in una run da minuti. I suoi unit test
// restano coperti da `pnpm test` (turbo -> `--project=unit`).
//
// Run:
//   pnpm test    -> turbo run test (il percorso vero, tutti i workspace)
//   vitest       -> questo aggregatore, dalla radice
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/db/vitest.config.ts',
      'packages/ui/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'packages/i18n/vitest.config.ts',
      'packages/api-client/vitest.config.ts',
      'packages/auth/vitest.config.ts',
      'packages/auth-web/vitest.config.ts',
      'packages/platform/vitest.config.ts',
      'apps/accountant-web/vitest.config.ts',
    ],
  },
});
