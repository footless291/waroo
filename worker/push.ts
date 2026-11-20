/**
 * Web Push, without payloads.
 *
 * The relay can't read what happened in a group, so it can't say it. It only
 * wakes the phone ("something new in this room"); the phone's service worker
 * then fetches the encrypted items, decrypts them with the group key it holds,
 * and writes the notification itself. Push services (Apple, Google, Mozilla)
 * learn only that a wake-up happened.
 *
 * Requests are signed with VAPID (RFC 8292): an ES256 JWT proving they come
 * from this relay, so nobody else can push to these subscriptions.
 */

export interface PushEnv {
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_JWK?: string
  VAPID_SUBJECT?: string
  /** Development only: extra hosts allowed as push endpoints, plain http too. */
  PUSH_TEST_HOSTS?: string
}

/** Real push services. Anything else is refused, so the relay can't be aimed at arbitrary sites. */
const PUSH_HOSTS = [
  /\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^android\.googleapis\.com$/,
  /(^|\.)push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/,
]

export function isPushEndpoint(endpoint: unknown, env: PushEnv): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return false
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  const testHosts = (env.PUSH_TEST_HOSTS ?? '').split(',').filter(Boolean)
  if (testHosts.includes(url.host)) return url.protocol === 'http:' || url.protocol === 'https:'
  return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname))
}

const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of u8) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const enc = new TextEncoder()

let signingKey: Promise<CryptoKey> | undefined
let signingKeyFor = ''

/** The VAPID Authorization header for one push service. */
export async function vapidAuthorization(endpoint: string, env: PushEnv, now = Date.now()): Promise<string> {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY) throw new Error('Push is not configured')
  if (!signingKey || signingKeyFor !== env.VAPID_PRIVATE_JWK) {
    signingKeyFor = env.VAPID_PRIVATE_JWK
    signingKey = crypto.subtle.importKey(
      'jwk',
      JSON.parse(env.VAPID_PRIVATE_JWK),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    )
  }
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: env.VAPID_SUBJECT ?? 'https://github.com/footless291/footless',
      }),
    ),
  )
  const unsigned = `${header}.${claims}`
  // WebCrypto's ECDSA signature is already the raw r||s form JWTs use.
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey, enc.encode(unsigned))
  return `vapid t=${unsigned}.${b64url(signature)}, k=${env.VAPID_PUBLIC_KEY}`
}

export type PushResult = 'sent' | 'gone' | 'failed'

/** Wakes one phone. 'gone' means the subscription is dead and should be forgotten. */
export async function sendPush(endpoint: string, env: PushEnv): Promise<PushResult> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(endpoint, env),
        // Keep it for a day if the phone is off; deliver promptly.
        TTL: '86400',
        Urgency: 'high',
        'Content-Length': '0',
      },
      signal: AbortSignal.timeout(8000),
    })
    if (res.status === 404 || res.status === 410) return 'gone'
    if (!res.ok) {
      console.warn(JSON.stringify({ push: new URL(endpoint).host, status: res.status, body: (await res.text()).slice(0, 200) }))
      return 'failed'
    }
    return 'sent'
  } catch (err) {
    console.warn(JSON.stringify({ push: 'error', error: String(err).slice(0, 200) }))
    return 'failed'
  }
}
