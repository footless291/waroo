/**
 * Light, dark, or whatever the phone uses. Kept in localStorage rather than
 * IndexedDB because it has to be read before the first paint (index.html
 * does that), so the app never flashes the wrong colours.
 */
export type Theme = 'system' | 'light' | 'dark'

const KEY = 'footless-theme'
const COLORS = { light: '#fff5ee', dark: '#16121f' }

export function getTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

export function setTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, theme)
  } catch {
    // Private browsing: it still applies for now.
  }
  applyTheme(theme)
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
  // The browser bar and status bar colour follow too.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light'
    meta.content = COLORS[theme === 'system' ? scheme : theme]
  }
}
