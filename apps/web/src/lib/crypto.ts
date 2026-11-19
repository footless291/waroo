/**
 * Everything cryptographic, using only the browser's built-in WebCrypto.
 *
 * - Each group has a 256-bit key (AES-GCM). It travels only in invite links,
 *   after the `#`, which browsers never send to a server.
 * - The relay room is named by a hash of that key, so the relay never sees
 *   the key, and the room name reveals nothing.
 * - Each phone has its own signing key per group (ECDSA P-256). The private
 *   half can't be exported, even by this app. Every event is signed, then
 *   encrypted, before it leaves the phone.
 */
import { signingBytes, type LedgerEvent } from '@footless/ledger'

const enc = new TextEncoder()
const dec = new TextDecoder()

export function toB64url(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let bin = ''
  for (const b of u8) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new Error('Not base64url')
  const bin = atob(text.replaceAll('-', '+').replaceAll('_', '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** A new random group key, as text for invite links. */
export function newGroupKey(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)))
}

export function isGroupKey(text: string): boolean {
  try {
    return fromB64url(text).length === 32
  } catch {
    return false
  }
}

const aesKeys = new Map<string, Promise<CryptoKey>>()
function aesKey(groupKey: string): Promise<CryptoKey> {
  let key = aesKeys.get(groupKey)
  if (!key) {
    key = crypto.subtle.importKey('raw', fromB64url(groupKey), 'AES-GCM', false, ['encrypt', 'decrypt'])
    aesKeys.set(groupKey, key)
  }
  return key
}

/** The relay room for a group: a hash of its key, safe to show the relay. */
export async function roomId(groupKey: string): Promise<string> {
  const label = enc.encode('footless-room-v1:')
  const key = fromB64url(groupKey)
  const input = new Uint8Array(label.length + key.length)
  input.set(label)
  input.set(key, label.length)
  return toB64url(await crypto.subtle.digest('SHA-256', input))
}

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const

/** A signing key pair for this phone in one group. The private key can't be exported. */
export async function newSigningKeys(): Promise<{ keys: CryptoKeyPair; publicKey: string }> {
  const keys = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify'])
  const publicKey = toB64url(await crypto.subtle.exportKey('raw', keys.publicKey))
  return { keys, publicKey }
}

export async function sign(event: LedgerEvent, privateKey: CryptoKey): Promise<string> {
  return toB64url(await crypto.subtle.sign(SIGN, privateKey, signingBytes(event)))
}

const verifyKeys = new Map<string, Promise<CryptoKey>>()
export async function verify(event: LedgerEvent, signature: string, publicKey: string): Promise<boolean> {
  try {
    let key = verifyKeys.get(publicKey)
    if (!key) {
      key = crypto.subtle.importKey('raw', fromB64url(publicKey), ECDSA, false, ['verify'])
      verifyKeys.set(publicKey, key)
    }
    return await crypto.subtle.verify(SIGN, await key, fromB64url(signature), signingBytes(event))
  } catch {
    return false
  }
}

/** What travels, encrypted: the event, its signature, and the signing key. */
interface Envelope {
  v: 1
  e: LedgerEvent
  s: string
  k: string
}

/** Encrypts a signed event for the relay. */
export async function seal(event: LedgerEvent, signature: string, groupKey: string): Promise<string> {
  const { signer, ...body } = event
  const envelope: Envelope = { v: 1, e: body as LedgerEvent, s: signature, k: signer! }
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await aesKey(groupKey),
    enc.encode(JSON.stringify(envelope)),
  )
  const out = new Uint8Array(12 + ciphertext.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ciphertext), 12)
  return toB64url(out)
}

/**
 * Decrypts and verifies a blob from the relay. Returns the event with
 * `signer` set to the key that signed it, or null for anything that doesn't
 * decrypt, doesn't parse, or whose signature doesn't check out.
 */
export async function unseal(
  data: string,
  groupKey: string,
): Promise<{ event: LedgerEvent; signature: string } | null> {
  try {
    const bytes = fromB64url(data)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await aesKey(groupKey),
      bytes.slice(12),
    )
    const envelope = JSON.parse(dec.decode(plain)) as Envelope
    if (envelope.v !== 1 || typeof envelope.s !== 'string' || typeof envelope.k !== 'string') return null
    const event = { ...envelope.e }
    delete event.signer
    if (!(await verify(event, envelope.s, envelope.k))) return null
    return { event: { ...event, signer: envelope.k }, signature: envelope.s }
  } catch {
    return null
  }
}
