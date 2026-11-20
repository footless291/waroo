// Makes a VAPID key pair for push notifications. The public key goes in
// wrangler.jsonc (vars.VAPID_PUBLIC_KEY); the private key is a secret:
//   node scripts/vapid.cjs   then   wrangler secret put VAPID_PRIVATE_JWK
(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url')
  console.log(JSON.stringify({ VAPID_PUBLIC_KEY: raw, VAPID_PRIVATE_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)) }))
})()
