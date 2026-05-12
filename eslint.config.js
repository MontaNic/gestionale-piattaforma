// ESLint 9 flat config — root of the monorepo.
// Workspaces (apps/*, packages/*, plugins/*) can extend this by importing it
// from their own eslint.config.js and adding framework-specific rules
// (e.g. Next.js, NestJS, React) as additional config objects.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
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
  // NestJS workspace (apps/api): override per i pattern del framework.
  // ESLint 9 flat config NON fa config-discovery automatica nei workspace,
  // quindi le override stanno qui scoped per glob. Vedi ADR-0007.
  {
    files: ['apps/api/**/*.ts'],
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
  },
);
