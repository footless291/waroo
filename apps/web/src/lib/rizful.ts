/**
 * Rizful's onboarding: the person signs up at Rizful, taps "Get code" there,
 * and pastes the one-time code here. Footless trades it, straight from the
 * phone, for a wallet connection (to pay) and a Lightning address (to get
 * paid). Nothing goes through Footless's server.
 * See github.com/MegalithicBTC/rizful-integration-demo.
 */
import { isLightningAddress } from '@footless/ledger'

export const RIZFUL = {
  signup: 'https://rizful.com/create-account',
  code: 'https://rizful.com/nostr_onboarding_auth_token/get_token',
  exchange: 'https://rizful.com/nostr_onboarding_auth_token/post_for_secrets',
}

export async function exchangeRizfulCode(code: string): Promise<{ nwc: string; address: string }> {
  // Rizful asks for a Nostr public key to tie the connection to. Footless has
  // no Nostr identity, so it makes a fresh one that's used for nothing else.
  const { schnorr } = await import('@noble/curves/secp256k1.js')
  const { bytesToHex } = await import('@noble/curves/utils.js')
  const publicKey = bytesToHex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()))

  let res: Response
  try {
    res = await fetch(RIZFUL.exchange, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ secret_code: code.trim(), nostr_public_key: publicKey }),
    })
  } catch {
    throw new Error('Couldn’t reach Rizful. Check your connection and try again.')
  }
  if (!res.ok) {
    throw new Error('That code didn’t work. Codes work once and expire quickly, so get a new one in Rizful and paste it again.')
  }
  const body = (await res.json().catch(() => null)) as { nwc_uri?: unknown; lightning_address?: unknown } | null
  const nwc = typeof body?.nwc_uri === 'string' ? body.nwc_uri.trim() : ''
  const address = typeof body?.lightning_address === 'string' ? body.lightning_address.trim().toLowerCase() : ''
  if (!/^nostr\+walletconnect:\/\//i.test(nwc) || !isLightningAddress(address)) {
    throw new Error('Rizful sent back something unexpected. Try again with a new code.')
  }
  return { nwc, address }
}
