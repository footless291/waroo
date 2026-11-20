import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { syncHub } from './lib/sync.ts'
import '@fontsource-variable/outfit'
import './styles.css'

syncHub.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
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
