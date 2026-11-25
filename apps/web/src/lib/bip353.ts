import { t } from '@lingui/core/macro'
/**
 * BIP-353 names: ₿bob@phoenixwallet.me, published in DNS as a TXT record
 * holding a bitcoin: URI with a BOLT12 offer (`lno=`).
 *
 * Looked up once, when the person adds the name on their own phone; the
 * offer itself is what's shared with the group. The lookup goes through
 * DNS-over-HTTPS, and is accepted only when the resolver says the answer was
 * DNSSEC-validated. (BIP-353 asks wallets to check DNSSEC themselves; here
 * the person is looking up their own name, and sees the result before
 * saving it.)
 */
import { cleanOffer, isOffer } from '@footless/ledger'

const RESOLVER = 'https://cloudflare-dns.com/dns-query'

/** "₿bob@phoenixwallet.me" or "bob@phoenixwallet.me" → its parts; null if it isn't one. */
export function parseName(text: string): { user: string; domain: string } | null {
  const m = /^\s*(?:₿|₿)?([a-z0-9._+-]{1,64})@((?:[a-z0-9-]{1,63}\.)+[a-z]{2,63})\s*$/i.exec(text)
  return m ? { user: m[1]!.toLowerCase(), domain: m[2]!.toLowerCase() } : null
}

export const looksLikeName = (text: string) => /^\s*(₿|₿)/.test(text) && parseName(text) !== null

/** Finds the BOLT12 offer behind a name. Throws with a plain reason if there isn't one. */
export async function resolveOffer(text: string): Promise<{ name: string; offer: string }> {
  const parts = parseName(text)
  if (!parts) throw new Error(t`That isn’t a name like ₿you@wallet.com`)
  const host = `${parts.user}.user._bitcoin-payment.${parts.domain}`
  let answer: { Status: number; AD?: boolean; Answer?: { type: number; data: string }[] }
  try {
    const res = await fetch(`${RESOLVER}?name=${encodeURIComponent(host)}&type=TXT&do=1`, {
      headers: { accept: 'application/dns-json' },
    })
    if (!res.ok) throw new Error(String(res.status))
    answer = await res.json()
  } catch {
    throw new Error(t`Couldn’t look the name up. Check your connection and try again.`)
  }
  if (answer.Status === 3 || !answer.Answer?.length) throw new Error(t`That name has no bitcoin payment details.`)
  if (answer.Status !== 0) throw new Error(t`Couldn’t look the name up right now.`)
  if (!answer.AD) throw new Error(t`The name’s records aren’t signed (DNSSEC), so Footless can’t trust them.`)
  for (const record of answer.Answer.filter((a) => a.type === 16)) {
    // A TXT record can come in several quoted pieces: join them.
    const pieces = record.data.match(/"((?:[^"\\]|\\.)*)"/g)
    const uri = pieces ? pieces.map((p) => p.slice(1, -1).replace(/\\(.)/g, '$1')).join('') : record.data
    if (!/^bitcoin:/i.test(uri)) continue
    const query = uri.split('?')[1] ?? ''
    for (const pair of query.split('&')) {
      const [key, value = ''] = pair.split('=')
      if (key?.toLowerCase() !== 'lno') continue
      const offer = cleanOffer(decodeURIComponent(value))
      if (isOffer(offer)) return { name: `₿${parts.user}@${parts.domain}`, offer }
    }
  }
  throw new Error(t`That name doesn’t have a BOLT12 offer.`)
}
