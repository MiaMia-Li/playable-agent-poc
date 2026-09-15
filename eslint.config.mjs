import nextPlugin from 'eslint-config-next'

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'skills/_shared/assets/starter/work/vendor/**',
    ],
  },
  ...nextPlugin,
]

export default eslintConfig
