/**
 * Money is always an integer number of minor units (yen, cents, sats) plus an
 * ISO 4217 currency code. Floating-point numbers never hold an amount.
 */

export type CurrencyCode = string

export class LedgerError extends Error {
  override name = 'LedgerError'
}

/** Throws unless `n` is a safe integer. Every amount passes through here. */
export function assertMinor(n: number, what = 'amount'): number {
  if (!Number.isSafeInteger(n)) {
    throw new LedgerError(`${what} must be a whole number of minor units, got ${n}`)
  }
  return n
}

const digitsCache = new Map<string, number>()

/**
 * Number of decimal places a currency uses (JPY 0, USD 2, KWD 3), taken from
 * the platform's Intl data so new currencies need no table here.
 */
export function minorDigits(currency: CurrencyCode): number {
  const code = currency.toUpperCase()
  const cached = digitsCache.get(code)
  if (cached !== undefined) return cached
  let digits: number
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    throw new LedgerError(`Unknown currency code: ${currency}`)
  }
  digitsCache.set(code, digits)
  return digits
}

const DECIMAL = /^(-)?(\d+)(?:\.(\d*))?$/

/**
 * Parses a decimal string typed by a person ("4800", "12.5", "-3.20") into
 * minor units, exactly. Rejects more decimals than the currency allows rather
 * than rounding silently.
 */
export function parseAmount(input: string, currency: CurrencyCode): number {
  const match = DECIMAL.exec(input.trim().replaceAll(',', ''))
  if (!match) throw new LedgerError(`Not an amount: "${input}"`)
  const [, sign, whole = '0', fraction = ''] = match
  const digits = minorDigits(currency)
  if (fraction.length > digits) {
    throw new LedgerError(`${currency} allows at most ${digits} decimal places: "${input}"`)
  }
  const minor = BigInt(whole + fraction.padEnd(digits, '0')) * (sign ? -1n : 1n)
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new LedgerError(`Amount too large: "${input}"`)
  }
  return Number(minor) + 0
}

/** Formats minor units for display in the viewer's locale. */
export function formatAmount(amount: number, currency: CurrencyCode, locale = 'en'): string {
  assertMinor(amount)
  const digits = minorDigits(currency)
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amount / 10 ** digits,
  )
}

/**
 * Converts a fiat amount to sats at a quoted bitcoin price.
 *
 * `btcPrice` is the price of one bitcoin in the fiat currency's major units,
 * as a decimal string (for example "15234567" yen or "98765.43" dollars), so
 * the conversion is exact integer arithmetic. The result is rounded UP: the
 * creditor always receives at least what they are owed.
 */
export function fiatToSats(amount: number, currency: CurrencyCode, btcPrice: string): number {
  assertMinor(amount)
  if (amount < 0) throw new LedgerError('Cannot convert a negative amount to sats')
  const match = DECIMAL.exec(btcPrice.trim())
  if (!match || match[1]) throw new LedgerError(`Not a valid price: "${btcPrice}"`)
  const [, , whole = '0', fraction = ''] = match
  const price = BigInt(whole + fraction) // price scaled by 10^fraction.length
  if (price === 0n) throw new LedgerError('Price must be greater than zero')
  // sats = amount / 10^digits / (price / 10^f) * 1e8
  //      = amount * 10^f * 1e8 / (price * 10^digits)
  const numerator = BigInt(amount) * 10n ** BigInt(fraction.length) * 100_000_000n
  const denominator = price * 10n ** BigInt(minorDigits(currency))
  const sats = (numerator + denominator - 1n) / denominator
  return Number(sats)
}
