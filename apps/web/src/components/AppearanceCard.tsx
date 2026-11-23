import { useState } from 'react'
import { getTheme, setTheme, type Theme } from '../lib/theme.ts'
import { Segmented } from './Segmented.tsx'

const OPTIONS: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** Light, dark, or follow the phone. Applies straight away and only on this phone. */
export function AppearanceCard() {
  const [theme, set] = useState<Theme>(getTheme)
  return (
    <div className="appearance">
      <Segmented
        label="Appearance"
        options={OPTIONS}
        value={theme}
        onChange={(t) => {
          set(t)
          setTheme(t)
        }}
      />
    </div>
  )
}
