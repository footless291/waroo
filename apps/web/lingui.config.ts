import { defineConfig } from '@lingui/cli'

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'ja'],
  // English is written in the code; a missing translation shows the English.
  fallbackLocales: { default: 'en' },
  catalogs: [{ path: '<rootDir>/src/locales/{locale}', include: ['src'] }],
})
