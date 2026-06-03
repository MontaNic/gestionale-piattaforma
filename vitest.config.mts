// =============================================================================
// vitest.config.ts (root) — Workspace projects pattern (Vitest 4+)
// =============================================================================
// Coordina i config Vitest dei workspace via `projects` array. Quando
// arriveranno apps/web, packages/* con test, aggiungerli qui.
//
// Run:
//   pnpm test                  -> turbo run test (propaga ai workspace)
//   pnpm test --filter @gestionale/api  -> solo apps/api
// =============================================================================

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'apps/api/vitest.config.ts',
      'packages/ui/vitest.config.ts',
      'packages/shared/vitest.config.ts',
      'packages/i18n/vitest.config.ts',
      'packages/api-client/vitest.config.ts',
    ],
  },
});
