/// <reference lib="webworker" />
/**
 * Waroo's service worker: works offline, and turns push wake-ups into
 * notifications.
 *
 * A push carries nothing: the relay can't read the groups, so it can't say
 * what happened. On a wake-up this worker catches up each group over HTTP,
 * decrypts and verifies what's new with the keys on this phone, saves it, and
 * writes the notification itself. The text never leaves the phone.
 */
import { replay, type LedgerEvent } from '@waroo/ledger'
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { i18n } from '@lingui/core'
import { t } from '@lingui/core/macro'
import { roomId } from './lib/crypto.ts'
import { getEvents, getGroup, getSetting, getStoredEvents, listGroups, putGroup, saveReceived, type GroupMeta } from './lib/db.ts'
import { messages as en } from './locales/en.po'
import { messages as ja } from './locales/ja.po'
import { describeEvent, severalNews, type News } from './lib/news.ts'
import { openItems, relayHttpUrl } from './lib/sync.ts'

declare const self: ServiceWorkerGlobalScope

precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html'), { denylist: [/^\/relay\//] }))

// "Reload" on the update prompt.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

/** Fetches, verifies and saves what's new in one group. Returns the new events. */
async function catchUp(group: GroupMeta): Promise<LedgerEvent[]> {
  const room = await roomId(group.key!)
  const known = new Set((await getStoredEvents(group.id)).map((e) => e.id))
  const fresh: LedgerEvent[] = []
  let since = group.cursor ?? 0
  for (let page = 0; page < 20; page++) {
    const res = await fetch(relayHttpUrl(`rooms/${room}/items?since=${since}`), { cache: 'no-store' })
    if (!res.ok) break
    const body = (await res.json()) as { items: { seq: number; id: string; data: string }[]; upTo: number; done: boolean }
    const opened = await openItems(body.items, group.key!)
    await saveReceived(group.id, opened, { quiet: true })
    fresh.push(...opened.map((o) => o.event).filter((e) => !known.has(e.id)))
    since = Math.max(since, body.upTo)
    if (body.done) break
  }
  const latest = await getGroup(group.id)
  if (latest && since > (latest.cursor ?? 0)) await putGroup({ ...latest, cursor: since })
  return fresh
}

async function notifyGroup(group: GroupMeta, news: News[], groupName: string) {
  const [first] = news
  if (!first) return
  const single = news.length === 1
  await self.registration.showNotification(single ? first.title : severalNews(groupName, news.length), {
    body: single ? first.detail : news.map((n) => n.title).join('\n'),
    icon: '/icon-192.png',
    tag: group.id,
    data: { route: `/g/${group.id}` },
  })
}

/** Notifications in the language the app last used (saved by lib/i18n.ts). */
async function useAppLanguage() {
  const locale = (await getSetting('language').catch(() => undefined)) === 'ja' ? 'ja' : 'en'
  if (i18n.locale !== locale) i18n.loadAndActivate({ locale, messages: locale === 'ja' ? ja : en })
}

async function onPush() {
  let shown = false
  try {
    await useAppLanguage()
    const groups = (await listGroups()).filter((g) => g.shared && g.key)
    for (const group of groups) {
      try {
        const fresh = await catchUp(group)
        if (fresh.length === 0) continue
        const state = replay(await getEvents(group.id))
        const name = state.name ?? group.name
        const news = fresh
          .map((e) => describeEvent(e, state, group.meId, name, e.author === group.meId))
          .filter((n): n is News => n !== null)
        if (news.length) {
          await notifyGroup(group, news, name)
          shown = true
        }
      } catch (err) {
        console.warn('push catch-up failed', err)
      }
    }
  } finally {
    // Browsers expect every push to show something; iPhones stop delivering
    // to apps that don't. If the news was already seen, say something brief.
    if (!shown) {
      await self.registration.showNotification('Waroo', {
        body: t`There’s something new in one of your groups.`,
        icon: '/icon-192.png',
        tag: 'waroo',
        data: { route: '/' },
      })
    }
  }
}

self.addEventListener('push', (event) => event.waitUntil(onPush()))

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const route = (event.notification.data as { route?: string } | null)?.route ?? '/'
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) {
        await open.focus()
        open.postMessage({ type: 'open', route })
      } else {
        await self.clients.openWindow(`/#${route}`)
      }
    })(),
  )
})
