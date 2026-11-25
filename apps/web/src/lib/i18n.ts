/**
 * Which language the app speaks. Follows the phone unless the person picks
 * one in Settings. Changing it reloads the app, so every string (including
 * ones worked out outside React) comes out in the new language.
 *
 * The resolved language is also saved in IndexedDB, for the service worker:
 * it writes notifications, and can't read localStorage.
 */
import { i18n } from '@lingui/core'
import { setSetting } from './db.ts'

export type Locale = 'en' | 'ja'
export type LanguageChoice = 'system' | Locale

/** Each language in its own name, so anyone can find theirs. */
export const LANGUAGES: { code: Locale; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'ja', name: '日本語' },
]

const KEY = 'waroo-language'

export function languageChoice(): LanguageChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'en' || value === 'ja' ? value : 'system'
  } catch {
    return 'system'
  }
}

/** The first of the phone's languages that Waroo speaks; English otherwise. */
export function phoneLocale(): Locale {
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0]
    if (base === 'ja' || base === 'en') return base
  }
  return 'en'
}

export function currentLocale(): Locale {
  const choice = languageChoice()
  return choice === 'system' ? phoneLocale() : choice
}

async function catalog(locale: Locale) {
  return locale === 'ja' ? (await import('../locales/ja.po')).messages : (await import('../locales/en.po')).messages
}

/** Loads the language before the first screen renders. */
export async function startI18n(): Promise<void> {
  const locale = currentLocale()
  i18n.loadAndActivate({ locale, messages: await catalog(locale) })
  document.documentElement.lang = locale
  void setSetting('language', locale).catch(() => {})
}

export function setLanguage(choice: LanguageChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Private browsing: nothing to keep it in.
  }
  location.reload()
}
