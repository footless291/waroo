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
