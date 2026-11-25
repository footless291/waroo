import { i18n } from '@lingui/core'
import { I18nProvider } from '@lingui/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { publishProfile } from './lib/db.ts'
import { startI18n } from './lib/i18n.ts'
import { syncHub } from './lib/sync.ts'
import './lib/rekey.ts'
import '@fontsource-variable/outfit'
import './styles.css'

syncHub.start()
syncHub.setVisible(document.visibilityState === 'visible')
document.addEventListener('visibilitychange', () => syncHub.setVisible(document.visibilityState === 'visible'))
// Publishes this phone's box key in groups made before keys could change.
void publishProfile().catch((err) => console.warn('profile', err))

// The language loads first: nothing renders until it's ready.
await startI18n()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider i18n={i18n}>
      <App />
    </I18nProvider>
  </StrictMode>,
)

// Hand over from the splash once the first screen has painted. A short
// minimum keeps it from flickering on fast launches.
const splash = document.getElementById('splash')
if (splash) {
  const shownFor = performance.now()
  setTimeout(
    () =>
      requestAnimationFrame(() => {
        splash.classList.add('gone')
        setTimeout(() => splash.remove(), 300)
      }),
    Math.max(0, 450 - shownFor),
  )
}
