import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // An error, and the codebase holds to it.
      //
      // This UI was written with `any` as its house style — screens took
      // `({ theme, darkMode }: any)` and passed loosely-shaped objects
      // around. There were about 300 of them. That is not a style
      // question: the Journal screen sorted on `entry.date` and
      // `entry.time`, fields this API has never sent, so every comparison
      // ran against `undefined` and the sort control did nothing at all,
      // silently, for as long as the screen existed. The app-wide theme
      // object defined six keys while screens read seventeen, so the
      // other eleven resolved to `undefined` and those styles were
      // dropped without a sound. `any` did not cause either bug; it made
      // both of them impossible to find.
      //
      // They are typed now — `src/types.ts` for the API payloads,
      // `src/theme.ts` for the palette — so the rule is an error, which
      // is what keeps the next one from getting in. Where a shape is
      // genuinely unknown (a socket frame, a DRF error body) the codebase
      // uses `unknown` and narrows it, which is the honest version of the
      // same admission.
      '@typescript-eslint/no-explicit-any': 'error',

      // Same reasoning: an unused `err` in a catch block is worth seeing,
      // not worth failing a build over.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
])
