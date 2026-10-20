import nextra from 'nextra'
import path from 'node:path'

const withNextra = nextra({
  defaultShowCopyCode: true,
})

export default withNextra({
  reactStrictMode: true,
  i18n: {
    locales: ['en', 'es'],
    defaultLocale: 'es',
  },
  transpilePackages: ['nextra-theme-docs', 'nextra'],
})
