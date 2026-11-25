import { t } from '@lingui/core/macro'
import { formatAmount, minorDigits, type CurrencyCode } from '@waroo/ledger'
import { locale } from './hooks.ts'

export const money = (amount: number, currency: CurrencyCode) =>
  formatAmount(amount, currency, locale())

/** "10,000 sats" */
export function satsText(sats: number): string {
  const n = new Intl.NumberFormat(locale()).format(sats)
  return t`${n} sats`
}

/** Minor units → the plain decimal a person would type, e.g. 1250 USD → "12.50". */
export function toInput(amount: number, currency: CurrencyCode): string {
  const digits = minorDigits(currency)
  if (digits === 0) return String(amount)
  const sign = amount < 0 ? '-' : ''
  const abs = String(Math.abs(amount)).padStart(digits + 1, '0')
  return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`
}

/** Common currencies first; the rest of ISO 4217 is still accepted by the ledger. */
export const CURRENCIES: CurrencyCode[] = [
  'JPY', 'USD', 'EUR', 'GBP', 'KRW', 'TWD', 'CNY', 'HKD', 'SGD', 'THB', 'AUD', 'CAD', 'CHF', 'NZD',
]

export function currencyName(code: CurrencyCode): string {
  try {
    return new Intl.DisplayNames([locale()], { type: 'currency' }).of(code) ?? code
  } catch {
    return code
  }
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(locale(), { month: 'short', day: 'numeric' }).format(
    new Date(`${iso}T00:00:00`),
  )
}

export const today = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** True for someone whose phone was removed from the group (until they rejoin). */
export function isRemoved(state: { signed?: boolean }, member: { removedBy?: string; key?: unknown }): boolean {
  return !!state.signed && member.removedBy !== undefined && member.key === undefined
}

/**
 * A person's name as said politely in a sentence or a list: "Bob" in
 * English, "Bobさん" in Japanese.
 */
export function politeName(name: string): string {
  return t({ context: 'a person’s name, said politely', message: `${name}` })
}
