/**
 * This person's wallets, in two ranked lists:
 *
 * - Receive: Lightning addresses. The whole list goes to every group, so a
 *   friend paying tries the first, then the next if it can't take a payment.
 * - Send: wallets this phone can ask to pay (Nostr Wallet Connect, or a
 *   browser wallet). Never shared: a connection can spend, so it stays here.
 *
 * One wallet can be in both lists (Coinos and Rizful are), at different
 * places. `provider` lets the You screen show whether a wallet we have a
 * guide for is connected.
 */
import { isOffer } from '@waroo/ledger'
import { getSetting, publishProfile, setSetting } from './db.ts'

export type Provider = 'coinos' | 'rizful' | 'other'

/** Somewhere to receive: a Lightning address, or a BOLT12 offer (`lno1…`). */
export interface ReceiveWallet {
  id: string
  provider: Provider
  address: string
  /** For an offer: the ₿name it came from, if it came from one. */
  name?: string
}

export const isOfferWallet = (w: ReceiveWallet) => isOffer(w.address)

export type SendWallet = { id: string; provider: Provider; name: string } & (
  | { kind: 'nwc'; url: string }
  | { kind: 'webln' }
)

/** A send wallet before it has an id. (Omit over each kind separately, so `url` stays.) */
export type NewSendWallet = SendWallet extends infer W ? (W extends SendWallet ? Omit<W, 'id'> : never) : never

export const PROVIDERS: Record<Exclude<Provider, 'other'>, { name: string; domain: string }> = {
  coinos: { name: 'Coinos', domain: 'coinos.io' },
  rizful: { name: 'Rizful', domain: 'rizful.com' },
}

export function providerOf(address: string): Provider {
  if (isOffer(address)) return 'other'
  const domain = address.split('@')[1]?.toLowerCase()
  if (domain === PROVIDERS.coinos.domain) return 'coinos'
  if (domain === PROVIDERS.rizful.domain) return 'rizful'
  return 'other'
}

const newId = () => crypto.randomUUID()

export async function receiveWallets(): Promise<ReceiveWallet[]> {
  const list = (await getSetting('receiveWallets')) as ReceiveWallet[] | undefined
  if (list) return list
  // Phones from before lists: one address.
  const old = (await getSetting('lightningAddress')) as string | undefined
  return old ? [{ id: newId(), provider: providerOf(old), address: old }] : []
}

export async function sendWallets(): Promise<SendWallet[]> {
  const list = (await getSetting('sendWallets')) as SendWallet[] | undefined
  if (list) return list
  // Phones from before lists: one connected wallet.
  const old = (await getSetting('wallet')) as
    | { kind: 'nwc'; url: string; name: string }
    | { kind: 'webln'; name: string }
    | undefined
  if (!old) return []
  return [{ id: newId(), provider: old.kind === 'nwc' ? nwcProvider(old.url) : 'other', ...old }]
}

/** Saves the receive list and tells every group, so friends pay the right addresses in the right order. */
export async function saveReceiveWallets(list: ReceiveWallet[]): Promise<void> {
  await setSetting('receiveWallets', list)
  await setSetting('lightningAddress', undefined)
  await publishProfile()
}

export async function saveSendWallets(list: SendWallet[]): Promise<void> {
  await setSetting('sendWallets', list)
  await setSetting('wallet', undefined)
}

/**
 * Adds addresses or offers at the bottom of the receive list, in order,
 * skipping any already there. One update to the groups. `names` labels
 * offers that came from a ₿name.
 */
export async function addReceive(...addresses: string[]): Promise<void> {
  return addReceiveNamed(addresses)
}

export async function addReceiveNamed(addresses: string[], names: Record<string, string> = {}): Promise<void> {
  const list = await receiveWallets()
  for (const address of addresses) {
    const clean = address.trim().toLowerCase()
    if (!list.some((w) => w.address === clean)) {
      list.push({ id: newId(), provider: providerOf(clean), address: clean, ...(names[clean] ? { name: names[clean] } : {}) })
    }
  }
  await saveReceiveWallets(list)
}

/** How a receive wallet is shown: an offer by its ₿name, or as a shortened offer. */
export function receiveLabel(w: ReceiveWallet): string {
  if (!isOffer(w.address)) return w.address
  return w.name ?? `${w.address.slice(0, 10)}…${w.address.slice(-6)}`
}

/** Adds a wallet at the bottom of the send list, unless the same connection is already there. */
export async function addSend(wallet: NewSendWallet): Promise<void> {
  const list = await sendWallets()
  const same = (w: SendWallet) =>
    w.kind === wallet.kind && (w.kind === 'webln' || (wallet.kind === 'nwc' && w.url === wallet.url))
  if (list.some(same)) return
  await saveSendWallets([...list, { ...wallet, id: newId() } as SendWallet])
}

/** Guesses who runs a connection from its relay, for showing Coinos or Rizful as connected. */
export function nwcProvider(url: string): Provider {
  const text = decodeURIComponent(url).toLowerCase()
  if (text.includes('coinos')) return 'coinos'
  if (text.includes('rizful') || text.includes('megalith')) return 'rizful'
  return 'other'
}

export function sendLabel(w: SendWallet): string {
  return w.provider === 'other' ? w.name : PROVIDERS[w.provider].name
}

// ---- Names you give your wallets ----

/**
 * One name per wallet, shared by Send and Receive: Coinos and Rizful by
 * provider; another wallet's receive address matches a connection that
 * names the same Lightning address (NWC's `lud16`). Names stay on this
 * phone; groups only ever see addresses.
 */
export function walletKey(w: ReceiveWallet | SendWallet): string {
  if (w.provider !== 'other') return w.provider
  if ('address' in w) return w.address.toLowerCase()
  if (w.kind === 'webln') return 'webln'
  try {
    const lud16 = new URL(w.url.replace(/^nostr\+walletconnect:\/\//i, 'https://x/')).searchParams.get('lud16')
    if (lud16) return lud16.toLowerCase()
  } catch {
    // Not a URL we can read: the connection gets its own name.
  }
  return `send:${w.id}`
}

export async function walletNames(): Promise<Record<string, string>> {
  return ((await getSetting('walletNames')) as Record<string, string> | undefined) ?? {}
}

/** Renames a wallet everywhere it appears. An empty name goes back to the default. */
export async function renameWallet(key: string, name: string): Promise<Record<string, string>> {
  const names = { ...(await walletNames()) }
  const clean = name.trim().slice(0, 40)
  if (clean) names[key] = clean
  else delete names[key]
  await setSetting('walletNames', names)
  return names
}
