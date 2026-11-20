/**
 * The person's own wallet, used to pay. Never anyone else's money: Footless
 * only asks the wallet to pay an invoice the person has just confirmed.
 *
 * Two ways to connect:
 * - Nostr Wallet Connect (NWC): a connection string from the person's wallet
 *   app, ideally with a spending budget. Stored only on this phone.
 * - WebLN: a browser wallet extension such as Alby.
 */
import { getSetting, setSetting } from './db.ts'

export type WalletInfo = { kind: 'nwc'; url: string; name: string } | { kind: 'webln'; name: string }

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

export async function connectedWallet(): Promise<WalletInfo | undefined> {
  return (await getSetting('wallet')) as WalletInfo | undefined
}

export async function disconnectWallet(): Promise<void> {
  await setSetting('wallet', undefined)
}

/** Connects with an NWC string after checking the wallet answers. */
export async function connectNwc(url: string): Promise<WalletInfo> {
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
  const wallet: WalletInfo = { kind: 'nwc', url: trimmed, name }
  await setSetting('wallet', wallet)
  return wallet
}

export async function connectWebln(): Promise<WalletInfo> {
  if (!window.webln) throw new Error('No browser wallet found.')
  await window.webln.enable()
  let name = 'Browser wallet'
  try {
    name = (await window.webln.getInfo?.())?.node?.alias || name
  } catch {
    // Some wallets don't share their name.
  }
  const wallet: WalletInfo = { kind: 'webln', name }
  await setSetting('wallet', wallet)
  return wallet
}

/** Asks the connected wallet to pay. Returns the preimage the wallet reports. */
export async function payWithWallet(wallet: WalletInfo, invoice: string): Promise<string> {
  if (wallet.kind === 'webln') {
    if (!window.webln) throw new Error('Your browser wallet isn’t available right now.')
    await window.webln.enable()
    return (await window.webln.sendPayment(invoice)).preimage
  }
  const { NWCClient } = await import('@getalby/sdk/nwc')
  const client = new NWCClient({ nostrWalletConnectUrl: wallet.url })
  try {
    return (await client.payInvoice({ invoice })).preimage
  } finally {
    client.close()
  }
}
