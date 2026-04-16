import antfu from '@antfu/eslint-config';

export default antfu({
  typescript: true,
  react: true,
  stylistic: {
    indent: 2,
    quotes: 'single',
    semi: true,
  },
  ignores: [
    'dist/**',
    'src/app/routeTree.gen.ts',
    'src/shared/components/ui/**',
  ],
  rules: {
    'react/prefer-destructuring-assignment': 'off',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'node/prefer-global/process': 'off',
    'style/jsx-one-expression-per-line': 'off',
    'style/multiline-ternary': 'off',
    'style/arrow-parens': 'off',
    'antfu/top-level-function': 'off',
  },
});
