import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.vitest/**'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx,js,mjs}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
    },
    rules: {
      // Underscore-prefixed names are an explicit "intentionally unused" signal.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // The exports map is the public surface of a package (.claude/rules/architecture.md).
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@va/*/src/*'],
              message: 'Import from the package root (@va/<name>), never from its src/ internals.',
            },
          ],
        },
      ],
    },
  },
  {
    // The PWA: React rules, browser globals, and the confirm() ban (web.md: shared dialog only).
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-globals': [
        'error',
        { name: 'confirm', message: 'Use the shared confirm dialog, never the native confirm().' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'window',
          property: 'confirm',
          message: 'Use the shared confirm dialog, never window.confirm().',
        },
      ],
    },
  },
  {
    // Layer rule (from Landmark): components → hooks → services → clients. Hooks orchestrate state
    // and call services; services own the Supabase queries.
    files: ['apps/web/src/**/hooks/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportDeclaration[source.value=/(\\u002Fsupabase|@supabase\\u002Fsupabase-js)$/]',
          message:
            'Hooks must call services, not the Supabase client directly. Move the query to a services/ file and import that. See .claude/rules/web.md.',
        },
      ],
    },
  },
)
