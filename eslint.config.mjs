import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2020, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-unused-vars': 'off',
      // React Compiler-readiness rule (added in eslint-plugin-react-hooks v7);
      // this project doesn't use the Compiler, and it flags the standard
      // "reset state, then kick off an async load" effect pattern used
      // throughout src/components as an error.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    // Electron main/preload process — no DOM/window globals.
    files: ['electron/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Context/toggle colocated with its hooks/constants — Fast Refresh
    // granularity is not worth splitting these files for.
    files: ['src/theme.tsx', 'src/components/ThemeToggle.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
)
