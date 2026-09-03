module.exports = {
  root: true,
  env: { browser: true, es2020: true, node: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'dist-electron', 'release', 'node_modules', '*.cjs'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': [
      'warn',
      { allowConstantExport: true },
    ],
    // React Compiler-readiness rule (added in eslint-plugin-react-hooks v7);
    // this project doesn't use the Compiler, and it flags the standard
    // "reset state, then kick off an async load" effect pattern used
    // throughout src/components as an error.
    'react-hooks/set-state-in-effect': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    'no-unused-vars': 'off',
  },
  overrides: [
    {
      files: ['electron/**/*.ts'],
      env: { browser: false, node: true },
    },
    {
      files: ['**/*.test.ts', '**/*.test.tsx'],
      env: { node: true },
    },
    {
      // Context provider colocated with its hooks/constants — Fast Refresh
      // granularity is not worth splitting this file for.
      files: ['src/theme.tsx'],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
}
