import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isPushEndpoint, vapidAuthorization } from './push.ts'

const b64 = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))

async function keys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const pub = btoa(String.fromCharCode(...raw)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  return { pair, env: { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)), VAPID_SUBJECT: 'https://example.com' } }
}

describe('VAPID', () => {
  it('signs a JWT the push service can verify with our public key', async () => {
    const { pair, env } = await keys()
    const now = Date.UTC(2026, 10, 20)
    const auth = await vapidAuthorization('https://web.push.apple.com/abc', env, now)
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(auth)!
    assert.ok(m, auth)
    assert.equal(m[4], env.VAPID_PUBLIC_KEY)
    const claims = JSON.parse(new TextDecoder().decode(b64(m[2]!)))
    assert.equal(claims.aud, 'https://web.push.apple.com')
    assert.equal(claims.sub, 'https://example.com')
    assert.equal(claims.exp, now / 1000 + 12 * 3600)
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, b64(m[3]!), new TextEncoder().encode(`${m[1]}.${m[2]}`))
    assert.ok(ok)
  })
})

describe('push endpoints', () => {
  it('accepts the real push services', () => {
    for (const url of [
      'https://web.push.apple.com/QGx',
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=x',
    ]) assert.ok(isPushEndpoint(url, {}), url)
  })
  it('refuses anything else', () => {
    for (const url of ['http://fcm.googleapis.com/x', 'https://evil.example/push.apple.com', 'https://apple.com.evil.example', 'javascript:alert(1)', 42])
      assert.ok(!isPushEndpoint(url, {}), String(url))
  })
  it('allows test hosts only when configured', () => {
    assert.ok(!isPushEndpoint('http://127.0.0.1:9911/p', {}))
    assert.ok(isPushEndpoint('http://127.0.0.1:9911/p', { PUSH_TEST_HOSTS: '127.0.0.1:9911' }))
  })
})
