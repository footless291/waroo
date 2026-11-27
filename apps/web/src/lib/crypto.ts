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
import { signingBytes, type LedgerEvent } from '@waroo/ledger'

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
export function roomId(groupKey: string): Promise<string> {
  return hashedId('waroo-room-v1:', groupKey)
}

/** The relay's box for an invite link, from the secret in the link. */
export function inviteId(secret: string): Promise<string> {
  return hashedId('waroo-invite-v1:', secret)
}

/** The relay room for moving to a new phone, from the secret in the QR code. */
export function moveRoomId(secret: string): Promise<string> {
  return hashedId('waroo-move-v1:', secret)
}

/**
 * A short code both phones show while moving, so the person can check the
 * new phone is theirs and not someone who glimpsed the QR code.
 */
export async function moveCode(secret: string, newPhoneKey: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`waroo-move-code:${secret}:${newPhoneKey}`)))
  const n = ((digest[0]! << 24) | (digest[1]! << 16) | (digest[2]! << 8) | digest[3]!) >>> 0
  return String(n % 10000).padStart(4, '0')
}

/** Encrypts a JSON message with a 32-byte key (a group key or a move secret). */
export async function encryptJson(keyText: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyText), enc.encode(JSON.stringify(value)))
  const out = new Uint8Array(12 + ciphertext.byteLength)
  out.set(iv)
  out.set(new Uint8Array(ciphertext), 12)
  return toB64url(out)
}

/** The other half of encryptJson. Null for anything that doesn't decrypt. */
export async function decryptJson<T>(keyText: string, data: string): Promise<T | null> {
  try {
    const bytes = fromB64url(data)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, await aesKey(keyText), bytes.slice(12))
    return JSON.parse(dec.decode(plain)) as T
  } catch {
    return null
  }
}

async function hashedId(prefix: string, secret: string): Promise<string> {
  const label = enc.encode(prefix)
  const key = fromB64url(secret)
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

// ---- Handing a new group key to the members who stay ----

const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const

/**
 * This phone's box keys for a group (ECDH P-256): others lock new group keys
 * to the public half. The private half can't be exported.
 */
export async function newBoxKeys(): Promise<{ keys: CryptoKeyPair; publicKey: string }> {
  const keys = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  const publicKey = toB64url(await crypto.subtle.exportKey('raw', keys.publicKey))
  return { keys, publicKey }
}

/** An AES key both sides can make: from ECDH between one private and one public key, for one member. */
async function sharedKey(privateKey: CryptoKey, publicKey: string, memberId: string): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey('raw', fromB64url(publicKey), ECDH, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256)
  const material = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode('waroo-rekey-v1'), info: enc.encode(memberId) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Locks a group key to each member's box key, with a one-off key of our own. */
export async function wrapGroupKey(
  groupKey: string,
  recipients: { memberId: string; boxKey: string }[],
): Promise<{ ephemeral: string; wrapped: Record<string, string> }> {
  const eph = await crypto.subtle.generateKey(ECDH, true, ['deriveBits'])
  const ephemeral = toB64url(await crypto.subtle.exportKey('raw', eph.publicKey))
  const wrapped: Record<string, string> = {}
  for (const { memberId, boxKey } of recipients) {
    try {
      const key = await sharedKey(eph.privateKey, boxKey, memberId)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, fromB64url(groupKey)))
      const out = new Uint8Array(12 + ct.length)
      out.set(iv)
      out.set(ct, 12)
      wrapped[memberId] = toB64url(out)
    } catch {
      // A malformed box key: that member gets it later, when they publish a good one.
    }
  }
  return { ephemeral, wrapped }
}

/** Opens a group key locked to this phone. Null if it isn't for us or doesn't open. */
export async function unwrapGroupKey(
  wrapped: string,
  ephemeral: string,
  boxPrivate: CryptoKey,
  memberId: string,
): Promise<string | null> {
  try {
    const key = await sharedKey(boxPrivate, ephemeral, memberId)
    const bytes = fromB64url(wrapped)
    const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
    const groupKey = toB64url(raw)
    return isGroupKey(groupKey) ? groupKey : null
  } catch {
    return null
  }
}

/**
 * Friend tokens: proof, for a friend, that you're a given member of a group
 * they're also in, without telling them about groups they aren't in. The
 * token is an HMAC of the friendship and your member id under the group's
 * key, so only someone holding that key can recognise it.
 */
export async function friendToken(groupKey: string, friendshipId: string, memberId: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', fromB64url(groupKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return toB64url(await crypto.subtle.sign('HMAC', key, enc.encode(`waroo-friend-v1:${friendshipId}:${memberId}`)))
}

/** Signs a short text with a group signing key. */
export async function signText(text: string, privateKey: CryptoKey): Promise<string> {
  return toB64url(await crypto.subtle.sign(SIGN, privateKey, enc.encode(text)))
}

export async function verifyText(text: string, signature: string, publicKey: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', fromB64url(publicKey), ECDSA, false, ['verify'])
    return await crypto.subtle.verify(SIGN, key, fromB64url(signature), enc.encode(text))
  } catch {
    return false
  }
}
