import { assertMinor, LedgerError, type CurrencyCode } from './money.ts'
import { computeShares, type Expense, type PersonId } from './splits.ts'

/**
 * Proof that a bitcoin settlement happened, recorded alongside the fiat
 * amount. The fiat amount is what settled the debt; the rest is the receipt
 * (and the record a tax return needs).
 */
export interface BitcoinProof {
  sats: number
  /** Price of 1 BTC in the settlement currency's major units, as quoted. */
  btcPrice: string
  /** Where the price came from, e.g. "coingecko+kraken". */
  rateSource: string
  /** Lightning payment hash, hex. Empty when the payer's wallet didn't say (some BOLT12 payments). */
  paymentHash: string
  /** Paid to a BOLT12 offer, rather than an invoice from a Lightning address. */
  offer?: boolean
  /** Preimage, hex, once known. sha256(preimage) must equal paymentHash. */
  preimage?: string
  /** ISO timestamp the payment completed. */
  settledAt: string
}

export type SettlementMethod = 'bitcoin' | 'cash' | 'bank' | 'other'

/** One person paying another back. Settles debt in `currency`. */
export interface Settlement {
  id: string
  from: PersonId
  to: PersonId
  /** Positive, minor units of `currency`. */
  amount: number
  currency: CurrencyCode
  method: SettlementMethod
  bitcoin?: BitcoinProof
  note?: string
}

/**
 * Net position per currency per person. Positive: the group owes them.
 * Negative: they owe the group. Each currency's balances sum to zero.
 */
export type Balances = Map<CurrencyCode, Map<PersonId, number>>

function bump(balances: Balances, currency: CurrencyCode, person: PersonId, delta: number) {
  let byPerson = balances.get(currency)
  if (!byPerson) balances.set(currency, (byPerson = new Map()))
  byPerson.set(person, (byPerson.get(person) ?? 0) + delta)
}

/**
 * Recomputes balances from scratch. Debts stay in the currency they were
 * incurred in; nothing here converts between currencies.
 */
export function computeBalances(
  expenses: Iterable<Expense>,
  settlements: Iterable<Settlement> = [],
): Balances {
  const balances: Balances = new Map()
  for (const expense of expenses) {
    const currency = expense.currency.toUpperCase()
    for (const [p, paid] of Object.entries(expense.payers)) {
      bump(balances, currency, p, assertMinor(paid))
    }
    for (const [p, share] of computeShares(expense)) bump(balances, currency, p, -share)
  }
  for (const s of settlements) {
    assertMinor(s.amount)
    if (s.amount <= 0) throw new LedgerError('A settlement amount must be positive')
    if (s.from === s.to) throw new LedgerError('Cannot settle with yourself')
    const currency = s.currency.toUpperCase()
    bump(balances, currency, s.from, s.amount)
    bump(balances, currency, s.to, -s.amount)
  }
  // Drop zeros (and -0) so callers can treat absence as "settled".
  for (const [currency, byPerson] of balances) {
    for (const [p, v] of byPerson) if (v === 0) byPerson.delete(p)
    if (byPerson.size === 0) balances.delete(currency)
  }
  return balances
}

const toHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

const fromHex = (hex: string) => {
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(hex)) throw new LedgerError('Not valid hex')
  return new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)))
}

/**
 * True if `preimage` is the secret behind `paymentHash`, i.e. the Lightning
 * invoice was paid. Uses WebCrypto, available in browsers and Node.
 */
export async function verifyPreimage(paymentHash: string, preimage: string): Promise<boolean> {
  const digest = await crypto.subtle.digest('SHA-256', fromHex(preimage))
  return toHex(digest) === paymentHash.toLowerCase()
}
