/**
 * Paying a Lightning address, safely.
 *
 * 1. Ask the address's provider how to pay it (LNURL-pay, LUD-06/16).
 * 2. Ask for an invoice for an exact number of sats.
 * 3. Check the invoice before paying: right amount, right purpose, not
 *    expired. A provider that hands back anything else is refused.
 * 4. After paying, the preimage the wallet returns proves payment: its
 *    SHA-256 must equal the invoice's payment hash.
 *
 * The phone talks to the provider directly; Footless's server is never in
 * the middle of a payment.
 */
import { verifyPreimage } from '@footless/ledger'
import { decode } from 'light-bolt11-decoder'

export class PaymentError extends Error {
  override name = 'PaymentError'
}

export interface PayParams {
  callback: string
  minSats: number
  maxSats: number
  metadata: string
}

export interface CheckedInvoice {
  invoice: string
  sats: number
  paymentHash: string
  /** Seconds since epoch after which it can't be paid. */
  expiresAt: number
  /** LUD-21: a URL that says whether this invoice has been paid. */
  verify?: string
}

async function getJson(url: string): Promise<any> {
  let res: Response
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new PaymentError(
      'Couldn’t reach their Lightning address. It may not work from web apps, or you may be offline.',
    )
  }
  let body: any
  try {
    body = await res.json()
  } catch {
    throw new PaymentError('Their Lightning address sent back something unexpected.')
  }
  if (body?.status === 'ERROR') throw new PaymentError(`Their Lightning address said: ${String(body.reason ?? 'error')}`)
  if (!res.ok) throw new PaymentError('Their Lightning address isn’t working right now.')
  return body
}

const httpsUrl = (value: unknown): string => {
  try {
    const url = new URL(String(value))
    if (url.protocol === 'https:') return url.toString()
  } catch {
    // fall through
  }
  throw new PaymentError('Their Lightning address gave an unsafe link.')
}

/** Step 1: how to pay this address. */
export async function payParams(address: string): Promise<PayParams> {
  const [name, domain] = address.toLowerCase().split('@')
  if (!name || !domain) throw new PaymentError('That isn’t a Lightning address.')
  const body = await getJson(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`)
  if (body?.tag !== 'payRequest') throw new PaymentError('That Lightning address can’t receive payments.')
  const min = Math.ceil(Number(body.minSendable) / 1000)
  const max = Math.floor(Number(body.maxSendable) / 1000)
  if (!Number.isFinite(min) || !Number.isFinite(max) || typeof body.metadata !== 'string') {
    throw new PaymentError('Their Lightning address sent back something unexpected.')
  }
  return { callback: httpsUrl(body.callback), minSats: min, maxSats: max, metadata: body.metadata }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Reads the parts of an invoice we check. */
export function readInvoice(invoice: string) {
  let sections: { name: string; value?: unknown }[]
  try {
    sections = decode(invoice).sections as { name: string; value?: unknown }[]
  } catch {
    throw new PaymentError('Their Lightning address sent an invoice that doesn’t read correctly.')
  }
  const get = (name: string) => sections.find((s) => s.name === name)?.value
  const msats = get('amount')
  const timestamp = Number(get('timestamp'))
  const expiry = Number(decode(invoice).expiry ?? 3600)
  return {
    msats: msats === undefined ? undefined : BigInt(String(msats)),
    paymentHash: String(get('payment_hash') ?? ''),
    descriptionHash: get('description_hash') as string | undefined,
    expiresAt: timestamp + expiry,
  }
}

/** Steps 2 and 3: an invoice for exactly `sats`, checked before anyone pays it. */
export async function getInvoice(params: PayParams, sats: number, comment?: string): Promise<CheckedInvoice> {
  if (sats < params.minSats) throw new PaymentError(`Their Lightning address only takes ${params.minSats} sats or more.`)
  if (sats > params.maxSats) throw new PaymentError(`Their Lightning address takes at most ${params.maxSats} sats at once.`)
  const url = new URL(params.callback)
  url.searchParams.set('amount', String(sats * 1000))
  if (comment) url.searchParams.set('comment', comment.slice(0, 120))
  const body = await getJson(url.toString())
  const invoice = String(body?.pr ?? '')
  const read = readInvoice(invoice)

  if (read.msats !== BigInt(sats) * 1000n) {
    throw new PaymentError('Their Lightning address asked for a different amount. Nothing was paid.')
  }
  if (read.descriptionHash && read.descriptionHash !== (await sha256Hex(params.metadata))) {
    throw new PaymentError('The invoice doesn’t match their Lightning address. Nothing was paid.')
  }
  if (!/^[0-9a-f]{64}$/.test(read.paymentHash)) {
    throw new PaymentError('Their Lightning address sent an invoice that doesn’t read correctly.')
  }
  if (read.expiresAt * 1000 < Date.now() + 30_000) throw new PaymentError('The invoice had already expired. Try again.')
  return {
    invoice,
    sats,
    paymentHash: read.paymentHash,
    expiresAt: read.expiresAt,
    ...(typeof body.verify === 'string' ? { verify: httpsUrl(body.verify) } : {}),
  }
}

/** Step 4: proof of payment. */
export async function provesPayment(paymentHash: string, preimage: string | undefined): Promise<boolean> {
  if (!preimage || !/^[0-9a-f]{64}$/i.test(preimage)) return false
  return verifyPreimage(paymentHash, preimage.toLowerCase())
}

/**
 * For invoices paid outside the app: asks the provider (LUD-21) whether it's
 * been paid. Returns the preimage once it has.
 */
export async function checkPaid(invoice: CheckedInvoice): Promise<string | undefined> {
  if (!invoice.verify) return undefined
  try {
    const body = await getJson(invoice.verify)
    if (body?.settled && (await provesPayment(invoice.paymentHash, body.preimage))) return String(body.preimage)
  } catch {
    // Not yet, or the provider is having a moment; the caller polls again.
  }
  return undefined
}

/** The current price of one bitcoin, from Footless's Worker (which asks two sources). */
export async function btcPrice(currency: string): Promise<{ price: string; source: string; at: string }> {
  let res: Response
  try {
    res = await fetch(`/relay/rate?currency=${encodeURIComponent(currency)}`, { signal: AbortSignal.timeout(10_000) })
  } catch {
    throw new PaymentError('Couldn’t get the bitcoin price. Check your connection.')
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok || typeof body.price !== 'string') {
    throw new PaymentError(
      res.status === 502
        ? 'Bitcoin price sources disagree right now, so paying is paused. Try again in a minute.'
        : 'Couldn’t get the bitcoin price right now. Try again in a minute.',
    )
  }
  return { price: body.price, source: String(body.source), at: String(body.at) }
}
