import { t } from '@lingui/core/macro'
import { useState } from 'react'
import { languageChoice, LANGUAGES, setLanguage, type LanguageChoice } from '../lib/i18n.ts'
import { getTheme, setTheme, type Theme } from '../lib/theme.ts'
import { Segmented } from './Segmented.tsx'

/** Light, dark, or follow the phone. Applies straight away and only on this phone. */
export function AppearanceCard() {
  const [theme, set] = useState<Theme>(getTheme)
  return (
    <div className="appearance">
      <Segmented
        label={t`Appearance`}
        options={[
          { value: 'system', label: t`System` },
          { value: 'light', label: t`Light` },
          { value: 'dark', label: t`Dark` },
        ]}
        value={theme}
        onChange={(next) => {
          set(next)
          setTheme(next)
        }}
      />
    </div>
  )
}

/** The app's language: the phone's, or one picked here. Reloads the app to switch. */
export function LanguageCard() {
  const choice = languageChoice()
  return (
    <div className="appearance">
      <Segmented<LanguageChoice>
        label={t`Language`}
        options={[{ value: 'system', label: t`Phone’s` }, ...LANGUAGES.map((l) => ({ value: l.code, label: l.name }))]}
        value={choice}
        onChange={setLanguage}
      />
    </div>
  )
}
