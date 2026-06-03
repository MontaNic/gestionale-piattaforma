// ESLint 9 flat config — root of the monorepo.
// La config condivisa vive in `@gestionale/eslint-config` (ADR-0027 §D5 passo 1).
// Qui resta solo la composizione finale: la base agnostica + il preset NestJS
// applicato al glob dell'app. ESLint risolve i glob relativi a questo file (root),
// quindi il comportamento di linting e' identico a prima dell'estrazione.
import base, { nestjs } from '@gestionale/eslint-config';

export default [
  ...base,
  // NestJS workspace (apps/api): il glob app-specifico resta qui (conoscenza del
  // layout del repo), il preset di regole/parserOptions arriva dal package.
  {
    files: ['apps/api/**/*.ts'],
    ...nestjs,
  },
];
