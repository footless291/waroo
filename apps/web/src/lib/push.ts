/**
 * Turning notifications on and off on this phone.
 *
 * Subscribing gives a push-service URL for this phone. It's sent to each
 * group's relay room, nothing else: the relay learns which rooms to wake this
 * phone for, never who's in them or what happened.
 */
import { fromB64url } from './crypto.ts'
import { setSetting } from './db.ts'
import { pushEndpoint, relayHttpUrl, syncHub } from './sync.ts'

export type PushSupport =
  | 'ready' // can be turned on
  | 'on'
  | 'install-first' // iPhone or iPad in the browser: only Home Screen apps get notifications
  | 'blocked' // the person said no; only the phone's settings can undo that
  | 'unsupported'

const standalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

export async function pushSupport(): Promise<PushSupport> {
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))
  if (apple && !standalone()) return 'install-first'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'blocked'
  if (Notification.permission === 'granted' && (await pushEndpoint())) {
    // Still subscribed? The browser can drop a subscription on its own.
    const registration = await navigator.serviceWorker.ready
    const current = await registration.pushManager.getSubscription()
    if (current?.endpoint === (await pushEndpoint())) return 'on'
  }
  return 'ready'
}

/** Must be called from a tap: browsers only ask for permission then. */
export async function enablePush(): Promise<PushSupport> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'ready'
  const res = await fetch(relayHttpUrl('push-key'))
  if (!res.ok) throw new Error('Notifications aren’t available right now')
  const { key } = (await res.json()) as { key: string }
  const registration = await navigator.serviceWorker.ready
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(key) }))
  await setSetting('pushEndpoint', subscription.endpoint)
  syncHub.push({ t: 'subscribe', endpoint: subscription.endpoint })
  return 'on'
}

export async function disablePush(): Promise<void> {
  const endpoint = await pushEndpoint()
  if (endpoint) syncHub.push({ t: 'unsubscribe', endpoint })
  const registration = await navigator.serviceWorker.ready
  await (await registration.pushManager.getSubscription())?.unsubscribe()
  await setSetting('pushEndpoint', undefined)
}
