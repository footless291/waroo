import { lingui } from '@lingui/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
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
        globIgnores: ['splash/**'],
        // The service worker writes notifications, so it needs the translations too.
        buildPlugins: { vite: [lingui({ macroTransform: true })] },
      },
      devOptions: { enabled: false, type: 'module' },
    }),
  ],
})
