import { defineConfig } from 'tsup';

// Mirror del pattern packages/db (ADR-0007): dual-package ESM+CJS con estensioni
// esplicite .mjs/.cjs per un exports field deterministico. Nessun runtime dep da
// esternalizzare (solo costanti/tipi puri).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: {
    // tsup DTS rollup esegue un singolo emit: disabilita incremental ereditato
    // dalla tsconfig.base.json (TS5074 con --incremental senza tsBuildInfoFile).
    compilerOptions: { incremental: false },
  },
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: 'node20',
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
