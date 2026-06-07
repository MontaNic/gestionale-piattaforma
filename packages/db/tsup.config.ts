import { defineConfig } from 'tsup';

export default defineConfig({
  // Multi-entry: l'entry `.` (core agnostico) + il sub-entry `./nest`
  // (DbService/DbModule NestJS). La forma a oggetto preserva la sottocartella
  // di output -> dist/index.* e dist/nest/index.*.
  entry: {
    index: 'src/index.ts',
    'nest/index': 'src/nest/index.ts',
  },
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
  // @nestjs/common + reflect-metadata: runtime NestJS, non bundlare (identità
  // classi/decoratori per la DI). @gestionale/db: CRITICO — il sub-entry ./nest
  // importa `prisma` come self-reference; tenendolo external, dist/nest/index.cjs
  // fa require('@gestionale/db') -> entry `.` = singolo pool (no singleton inlinato).
  external: [
    '@prisma/client',
    '.prisma/client',
    '@nestjs/common',
    'reflect-metadata',
    '@gestionale/db',
  ],
  // Forziamo .mjs per ESM (default sarebbe .js per "type":"module" del pkg) e
  // .cjs per CommonJS: estensioni esplicite -> exports field deterministico,
  // niente ambiguità su come Node risolve i due artefatti.
  outExtension({ format }) {
    return { js: format === 'esm' ? '.mjs' : '.cjs' };
  },
});
