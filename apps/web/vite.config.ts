import { lingui } from '@lingui/vite-plugin'
import react from '@vitejs/plugin-react'
import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Which build this is, for bug reports: the commit Workers Builds deployed, or "dev".
const version = (process.env.WORKERS_CI_COMMIT_SHA ?? '').slice(0, 7) || 'dev'

/**
 * Receipt scanning reads text on the phone (Tesseract, in WebAssembly), so
 * its engine and the Japanese and English data are served from this site,
 * under /ocr/, and only fetched the first time someone scans. Copied from
 * node_modules at build time rather than kept in the repo.
 */
function ocrFiles(): Plugin {
  const require = createRequire(import.meta.url)
  const copy = () => {
    const out = join(import.meta.dirname, 'public', 'ocr')
    mkdirSync(out, { recursive: true })
    const tesseract = dirname(require.resolve('tesseract.js/package.json'))
    const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'))
    cpSync(join(tesseract, 'dist', 'worker.min.js'), join(out, 'worker.min.js'))
    for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
      cpSync(join(core, name), join(out, name))
    }
    for (const lang of ['jpn', 'eng']) {
      const data = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`))
      cpSync(join(data, '4.0.0_best_int', `${lang}.traineddata.gz`), join(out, `${lang}.traineddata.gz`))
    }
  }
  return { name: 'waroo-ocr-files', buildStart: copy }
}

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    ocrFiles(),
    react(),
    // Translations: turns t`…` and <Trans> into catalog lookups, and compiles .po files.
    lingui({ macroTransform: true }),
    VitePWA({
      registerType: 'prompt',
      // Our own service worker (src/sw.ts), for push notifications.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Waroo',
        short_name: 'Waroo',
        description: 'Split bills with friends and settle up in bitcoin, without anyone holding your money.',
        lang: 'en',
        start_url: '/',
        display: 'standalone',
        background_color: '#fff5ee', // Android's own splash
        theme_color: '#fff5ee',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // iOS reads launch images itself when the app is installed.
        // Nor the receipt reader: it's big, and fetched only when someone scans.
        globIgnores: ['splash/**', 'ocr/**'],
        // The service worker writes notifications, so it needs the translations too.
        buildPlugins: { vite: [lingui({ macroTransform: true })] },
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
})
