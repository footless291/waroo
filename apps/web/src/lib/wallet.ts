/**
 * The person's own wallet, used to pay. Never anyone else's money: Footless
 * only asks the wallet to pay an invoice the person has just confirmed.
 *
 * Two ways to connect:
 * - Nostr Wallet Connect (NWC): a connection string from the person's wallet
 *   app, ideally with a spending budget. Stored only on this phone.
 * - WebLN: a browser wallet extension such as Alby.
 */

import type { SendWallet } from './wallets.ts'

declare global {
  interface Window {
    webln?: {
      enable(): Promise<void>
      sendPayment(invoice: string): Promise<{ preimage: string }>
      getInfo?(): Promise<{ node?: { alias?: string } }>
    }
  }
}

export const hasWebln = () => typeof window.webln?.sendPayment === 'function'

/**
 * Checks an NWC connection string by asking the wallet for its name. Returns
 * the cleaned-up string and the name; stores nothing.
 */
export async function checkNwc(url: string): Promise<{ url: string; name: string }> {
  const trimmed = url.trim()
  if (!/^nostr\+walletconnect:\/\//i.test(trimmed)) {
    throw new Error('That isn’t a wallet connection. It should start with nostr+walletconnect://')
  }
  const { NWCClient } = await import('@getalby/sdk/nwc')
  let client
  try {
    client = new NWCClient({ nostrWalletConnectUrl: trimmed })
  } catch {
    throw new Error('That wallet connection is incomplete. Copy it again from your wallet.')
  }
  let name = 'Your wallet'
  try {
    const info = await Promise.race([
      client.getInfo(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15_000)),
    ])
    if (info.alias) name = info.alias
  } catch {
    client.close()
    throw new Error('Your wallet didn’t answer. Check it’s online and the connection allows payments.')
  }
  client.close()
  return { url: trimmed, name }
}

/** Asks the browser wallet extension for permission and its name. */
export async function checkWebln(): Promise<{ name: string }> {
  if (!window.webln) throw new Error('No browser wallet found.')
  await window.webln.enable()
  let name = 'Browser wallet'
  try {
    name = (await window.webln.getInfo?.())?.node?.alias || name
  } catch {
    // Some wallets don't share their name.
  }
  return { name }
}

/**
 * A payment that didn't work. `certain` says whether it definitely wasn't
 * paid: only then is it safe to offer the next wallet straight away.
 */
export class WalletPayError extends Error {
  readonly certain: boolean
  constructor(message: string, certain: boolean, cause?: unknown) {
    super(message, { cause })
    this.certain = certain
  }
}

/** Asks a wallet to pay. Returns the preimage the wallet reports; throws WalletPayError. */
export async function payWithWallet(wallet: SendWallet, invoice: string): Promise<string> {
  if (wallet.kind === 'webln') {
    if (!window.webln) throw new WalletPayError('the browser wallet isn’t available right now', true)
    try {
      await window.webln.enable()
    } catch (err) {
      throw new WalletPayError('the browser wallet didn’t allow Footless to pay', true, err)
    }
    try {
      return (await window.webln.sendPayment(invoice)).preimage
    } catch (err) {
      throw new WalletPayError(`it reported a problem (${(err as Error)?.message ?? err})`, false, err)
    }
  }
  const nwc = await import('@getalby/sdk/nwc')
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: wallet.url })
  try {
    return (await client.payInvoice({ invoice })).preimage
  } catch (err) {
    const { message, certain } = explainNwcError(err, nwc)
    throw new WalletPayError(message, certain, err)
  } finally {
    client.close()
  }
}

/**
 * Asks a wallet to pay a BOLT12 offer, through NWC's `pay` method (BIP-321
 * payment instructions). The wallet fetches the invoice from the offer
 * itself. Only some wallets support it; the rest say so, and nothing is paid.
 */
export async function payOfferWithWallet(
  wallet: SendWallet,
  offer: string,
  sats: number,
): Promise<{ preimage?: string; paymentHash?: string }> {
  if (wallet.kind === 'webln') throw new WalletPayError('it can’t pay BOLT12 offers', true)
  const nwc = await import('@getalby/sdk/nwc')
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: wallet.url })
  type PayResult = { state?: string; preimage?: string; payment_hash?: string; failure_reason?: string }
  // `pay` isn't in this library's list of methods yet, so the request goes through its general path.
  const execute = (client as unknown as {
    executeNip47Request(method: string, params: unknown, ok: (r: PayResult) => boolean): Promise<PayResult>
  }).executeNip47Request.bind(client)
  let result: PayResult
  try {
    result = await execute('pay', { payment: `bitcoin:?lno=${offer}`, amount: sats * 1000 }, (r) => !!r)
  } catch (err) {
    const code = (err as { code?: string })?.code
    if (code === 'NOT_IMPLEMENTED' || code === 'UNSUPPORTED_PAYMENT_INSTRUCTION' || code === 'UNSUPPORTED_NETWORK') {
      throw new WalletPayError('it can’t pay BOLT12 offers yet', true, err)
    }
    const { message, certain } = explainNwcError(err, nwc)
    throw new WalletPayError(message, certain, err)
  } finally {
    client.close()
  }
  if (result.state === 'failed') throw new WalletPayError(`the payment failed (${result.failure_reason ?? 'no reason given'})`, true)
  if (result.state === 'pending') throw new WalletPayError('it’s still sending the payment', false)
  return { preimage: result.preimage, paymentHash: result.payment_hash }
}

/**
 * Says which step of a wallet payment failed, in plain words, with the
 * technical reason after it so a failure can be diagnosed from a screenshot.
 * `certain` is true only when the payment can't have gone out.
 */
function explainNwcError(err: unknown, nwc: typeof import('@getalby/sdk/nwc')): { message: string; certain: boolean } {
  const detail = err instanceof Error ? err.message : String(err)
  const code = (err as { code?: string })?.code
  const tech = ` (${[code, detail].filter(Boolean).join(': ')})`
  if (err instanceof nwc.Nip47PublishTimeoutError || err instanceof nwc.Nip47PublishError || err instanceof nwc.Nip47NetworkError) {
    return { message: `Footless couldn’t reach it, so the request wasn’t sent${tech}`, certain: true }
  }
  if (err instanceof nwc.Nip47ReplyTimeoutError) {
    return { message: `it got the request but didn’t answer within a minute${tech}`, certain: false }
  }
  if (err instanceof nwc.Nip47UnsupportedEncryptionError) {
    return { message: `it uses a kind of encryption Footless doesn’t support${tech}`, certain: true }
  }
  if (err instanceof nwc.Nip47ResponseDecodingError) {
    return { message: `it answered in a way Footless couldn’t read${tech}`, certain: false }
  }
  if (err instanceof nwc.Nip47WalletError) {
    if (code === 'INSUFFICIENT_BALANCE') return { message: 'it doesn’t have enough in it', certain: true }
    if (code === 'QUOTA_EXCEEDED') return { message: 'this would go over the spending limit you set for Footless', certain: true }
    if (code === 'RESTRICTED' || code === 'UNAUTHORIZED' || code === 'NOT_IMPLEMENTED') {
      return { message: `it didn’t allow Footless to pay${tech}`, certain: true }
    }
    if (code === 'RATE_LIMITED') return { message: `it’s getting too many requests right now${tech}`, certain: true }
    if (code === 'PAYMENT_FAILED') return { message: `the payment failed${tech}`, certain: true }
    return { message: `it said: ${detail}${code ? ` (${code})` : ''}`, certain: false }
  }
  return { message: `the payment failed${tech}`, certain: false }
}
