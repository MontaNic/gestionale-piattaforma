// @gestionale/eslint-config — configurazione ESLint 9 flat config condivisa del core.
// ADR-0027 §D5 passo 1: tooling puro, zero runtime, agnostico rispetto al dominio.
//
// `base` (default export) e' la config condivisa framework-agnostica: i workspace la
// consumano tramite il flat config a root (`eslint.config.js`), che resta il punto
// in cui ESLint risolve i glob relativi alla radice del repo.
// `nestjs` e' un preset framework (parserOptions + regole) SENZA `files`: chi lo usa
// fornisce il proprio glob, cosi' il package non incolla il layout del repo.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export const base = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // File CommonJS (.cjs): override per riconoscere module/require/__dirname
  // come globals e usare sourceType 'commonjs'. Necessario per file di config
  // come commitlint.config.cjs che richiedono CommonJS in un progetto con
  // package.json "type": "module".
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
  },
);

// Preset NestJS (apps/api): override per i pattern del framework.
// ESLint 9 flat config NON fa config-discovery automatica nei workspace, quindi il
// consumer applica questo preset a un proprio glob (vedi ADR-0007). Le regole sono
// agnostiche rispetto al layout: il `files` resta a carico del root config.
export const nestjs = {
  languageOptions: {
    parserOptions: {
      // I decorator NestJS richiedono il flag legacy (TypeScript pre-stage-3)
      // + l'emit dei metadati per la reflection-based DI.
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
    },
  },
  rules: {
    // NestJS Module classes sono spesso shell con solo @Module decorator.
    '@typescript-eslint/no-extraneous-class': 'off',
    // Constructor injection: `constructor(private readonly x: X) {}` puo'
    // sembrare useless ma e' il pattern DI canonico.
    '@typescript-eslint/no-useless-constructor': 'off',
    // NestJS DI richiede import VALUE delle classi service iniettate
    // (decorator metadata via `emitDecoratorMetadata` legge il riferimento
    // runtime alla classe). `import type` le stripperebbe a compile-time
    // rompendo DI.
    '@typescript-eslint/consistent-type-imports': 'off',
  },
};

export default base;
