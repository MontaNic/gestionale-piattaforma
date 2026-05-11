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
);
