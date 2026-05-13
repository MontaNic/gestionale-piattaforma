import { defineConfig } from 'tsup';

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
  external: ['@prisma/client', '.prisma/client'],
  // Forziamo .mjs per ESM (default sarebbe .js per "type":"module" del pkg) e
  // .cjs per CommonJS: estensioni esplicite -> exports field deterministico,
  // niente ambiguità su come Node risolve i due artefatti.
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
