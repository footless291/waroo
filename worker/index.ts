/**
 * The Footless Worker: serves the app, and runs the sync relay.
 *
 * The relay is deliberately dumb. Each group has a room, addressed by an id
 * derived from the group's key, holding an ordered list of encrypted blobs.
 * The relay can't read them, can't tell who wrote them and can't forge them;
 * it only stores and forwards. Anyone can run their own copy.
 */
import { DurableObject } from 'cloudflare:workers'
import { agree, type Quote } from './price.ts'
import { InviteBox } from './invites.ts'
import { isPushEndpoint, sendPush, type PushEnv } from './push.ts'

export { InviteBox }

export interface Env extends PushEnv {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace<RelayRoom>
  INVITES: DurableObjectNamespace<InviteBox>
}

/** A room id is base64url of a SHA-256 digest: 43 characters. */
const ROOM_ID = /^[A-Za-z0-9_-]{43}$/
/** Blob ids are the events' own ids (UUIDs), never anything readable. */
const ITEM_ID = /^[A-Za-z0-9_-]{8,64}$/
const MAX_ITEM_BYTES = 64 * 1024
const MAX_ITEMS_PER_PUSH = 200
const MAX_ROOM_BYTES = 25 * 1024 * 1024
const PAGE = 500
const MAX_SUBSCRIPTIONS = 50
/** Rooms used once, to move to a new phone, are wiped this long after they open. */
const EPHEMERAL_MS = 60 * 60 * 1000

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/relay/health') return Response.json({ ok: true })
    if (url.pathname === '/relay/rate') return rate(url)
    if (url.pathname === '/relay/push-key') {
      return env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK
        ? Response.json({ key: env.VAPID_PUBLIC_KEY })
        : Response.json({ error: 'Notifications aren’t set up on this relay' }, { status: 501 })
    }

    const invite = /^\/relay\/invites\/([^/]+)(\/open)?$/.exec(url.pathname)
    if (invite) {
      if (!ROOM_ID.test(invite[1]!)) return new Response('Bad invite id', { status: 400 })
      return env.INVITES.getByName(invite[1]!).fetch(request)
    }

    const match = /^\/relay\/rooms\/([^/]+)(\/items)?$/.exec(url.pathname)
    if (match) {
      const room = match[1]!
      if (!ROOM_ID.test(room)) return new Response('Bad room id', { status: 400 })
      // Plain HTTP read, for the service worker catching up after a push.
      if (match[2]) {
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
        return env.ROOMS.getByName(room).fetch(request)
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected a WebSocket', { status: 426 })
      }
      return env.ROOMS.getByName(room).fetch(request)
    }
    if (url.pathname.startsWith('/relay/')) return new Response('Not found', { status: 404 })
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

/**
 * The price of one bitcoin in a currency, from several independent sources:
 * exchanges with a real market in that currency, plus a cross-check through
 * the US dollar.
 * Fetched here rather than by phones so the price sites never see who's
 * paying. Cached for a minute. Answers only when at least two sources agree
 * within 2%; one source alone is never trusted. Every source's answer is
 * included and logged, so a bad feed is easy to spot.
 */
async function rate(url: URL): Promise<Response> {
  const currency = (url.searchParams.get('currency') ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: 'Bad currency' }, { status: 400 })

  const cache = caches.default
  const cacheKey = new Request(`${url.origin}/relay/rate?v=3&currency=${currency}`, { method: 'GET' })
  const hit = await cache.match(cacheKey)
  if (hit) return hit

  const failures: Record<string, string> = {}
  const get = async (name: string, href: string, pick: (j: any) => unknown): Promise<Quote | null> => {
    try {
      const res = await fetch(href, {
        headers: { Accept: 'application/json', 'User-Agent': 'Footless/1 (+https://github.com/footless291/footless)' },
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) {
        failures[name] = `HTTP ${res.status}`
        return null
      }
      const value = Number(pick(await res.json()))
      if (Number.isFinite(value) && value > 0) return { name, price: value }
      failures[name] = 'no price in response'
    } catch (err) {
      failures[name] = String(err).slice(0, 100)
    }
    return null
  }
  const quotes = (await Promise.all(priceSources(currency).map((src) => get(src.name, src.url, src.pick)))).filter(
    (q): q is Quote => q !== null,
  )

  // A cross-check that works for any currency: bitcoin in US dollars from
  // several exchanges, times the official dollar exchange rate.
  if (currency !== 'USD') {
    const [usd, fx] = await Promise.all([
      Promise.all(USD_SOURCES.map((src) => get(src.name, src.url, src.pick))),
      get('ECB rate', `https://api.frankfurter.app/latest?from=USD&to=${currency}`, (j) =>
        j?.base === 'USD' ? j?.rates?.[currency] : undefined,
      ),
    ])
    const usdAgreed = agree(usd.filter((q): q is Quote => q !== null))
    if (usdAgreed.ok && fx) {
      quotes.push({ name: 'USD cross-check', price: usdAgreed.price * fx.price })
    } else if (!usdAgreed.ok) {
      failures['USD cross-check'] = usdAgreed.reason
    }
  }

  const result = agree(quotes)
  console.log(JSON.stringify({ rate: currency, quotes, failures, result: result.ok ? result.price : result.reason }))
  if (!result.ok) {
    return Response.json(
      {
        error: result.reason === 'too-few' ? 'Not enough price sources available right now' : 'Price sources disagree',
        quotes,
        failures,
      },
      { status: result.reason === 'too-few' ? 503 : 502 },
    )
  }
  const body = {
    currency,
    // A decimal string, so the app converts with exact integer arithmetic.
    price: result.price.toFixed(2),
    source: result.agreeing.map((q) => q.name).join('+'),
    quotes,
    at: new Date().toISOString(),
  }
  const response = Response.json(body, { headers: { 'Cache-Control': 'public, max-age=60' } })
  await cache.put(cacheKey, response.clone())
  return response
}

type Source = { name: string; url: string; pick: (j: any) => unknown }

/** Bitcoin in US dollars, for the cross-check. */
const USD_SOURCES: Source[] = [
  { name: 'Kraken USD', url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSD', pick: kraken },
  {
    name: 'Coinbase USD',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    pick: (j) => (j?.data?.base === 'BTC' && j?.data?.currency === 'USD' ? j.data.amount : undefined),
  },
  { name: 'Bitstamp USD', url: 'https://www.bitstamp.net/api/v2/ticker/btcusd/', pick: (j) => j?.last },
]

function kraken(j: any): unknown {
  const pairs = Object.values(j?.result ?? {}) as { c?: [string, string] }[]
  return pairs.length === 1 ? pairs[0]?.c?.[0] : undefined
}

/**
 * Exchanges that really trade bitcoin against this currency. Only real
 * markets: a "spot price" an exchange derives for a currency it doesn't
 * trade (Coinbase's BTC-JPY, for one) can be badly wrong.
 */
function priceSources(currency: string): Source[] {
  const sources: Source[] = []
  if (['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF'].includes(currency)) {
    sources.push({ name: 'Kraken', url: `https://api.kraken.com/0/public/Ticker?pair=XBT${currency}`, pick: kraken })
  }
  if (currency === 'JPY') {
    sources.push(
      {
        name: 'bitFlyer',
        url: 'https://api.bitflyer.com/v1/ticker?product_code=BTC_JPY',
        pick: (j) => (j?.product_code === 'BTC_JPY' ? j.ltp : undefined),
      },
      { name: 'bitbank', url: 'https://public.bitbank.cc/btc_jpy/ticker', pick: (j) => (j?.success === 1 ? j?.data?.last : undefined) },
      { name: 'Coincheck', url: 'https://coincheck.com/api/ticker?pair=btc_jpy', pick: (j) => j?.last },
    )
  }
  if (['USD', 'EUR', 'GBP'].includes(currency)) {
    const pair = `btc${currency.toLowerCase()}`
    sources.push({ name: 'Bitstamp', url: `https://www.bitstamp.net/api/v2/ticker/${pair}/`, pick: (j) => j?.last })
  }
  if (currency === 'USD') {
    sources.push({
      name: 'Coinbase',
      url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
      pick: (j) => (j?.data?.base === 'BTC' && j?.data?.currency === 'USD' ? j.data.amount : undefined),
    })
  }
  return sources
}

type ClientMessage =
  /** `ephemeral`: this room is for one hand-over and should be wiped soon. Only honoured on an empty room. */
  | { t: 'hello'; since: number; ephemeral?: boolean }
  /** `notify`: the sender says this is worth a notification (a payment, a join, a new expense). */
  | { t: 'push'; items: { id: string; data: string }[]; notify?: boolean }
  /** This connection's phone wants to be woken for this room while it isn't connected. */
  | { t: 'subscribe'; endpoint: string }
  | { t: 'unsubscribe'; endpoint: string }
  | { t: 'away' }
  | { t: 'here' }

type Row = { seq: number; id: string; data: string }
/**
 * A connection that subscribed for pushes. `at` is when it last said it's
 * here; `away` is set while the app is in the background.
 */
type Attachment = { endpoint?: string; at?: number; away?: boolean }

/** An open app pings every 20 seconds; a connection silent for longer is a phone that was put away. */
const LIVE_MS = 50_000

export class RelayRoom extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    // Answered without waking the room; the time is kept, to tell open apps from put-away phones.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    this.setup()
  }

  private setup() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL,
      at INTEGER NOT NULL
    )`)
    // Push subscriptions: only the push service's URL for a phone, nothing
    // about who it is. Kept per room so a wake-up names no other groups.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS subs (
      endpoint TEXT PRIMARY KEY,
      at INTEGER NOT NULL
    )`)
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      const since = Number(new URL(request.url).searchParams.get('since') ?? 0)
      const rows = this.page(Number.isSafeInteger(since) && since >= 0 ? since : 0)
      return Response.json(
        { items: rows, upTo: rows.at(-1)?.seq ?? since, done: rows.length < PAGE },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket]
    this.ctx.acceptWebSocket(server)
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ClientMessage
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw))
    } catch {
      return this.fail(ws, 'Not JSON')
    }

    if (msg.t === 'hello') {
      const since = Number.isSafeInteger(msg.since) && msg.since >= 0 ? msg.since : 0
      if (msg.ephemeral === true && this.isEmpty() && (await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.storage.setAlarm(Date.now() + EPHEMERAL_MS)
      }
      // Send the backlog in pages so a big room doesn't make one huge frame.
      let cursor = since
      for (;;) {
        const rows = this.page(cursor)
        const last = rows.at(-1)
        if (last) cursor = last.seq
        const done = rows.length < PAGE
        ws.send(JSON.stringify({ t: 'items', items: rows, upTo: cursor, done }))
        if (done) break
      }
      return
    }

    if (msg.t === 'push') {
      if (!Array.isArray(msg.items) || msg.items.length === 0 || msg.items.length > MAX_ITEMS_PER_PUSH) {
        return this.fail(ws, 'Bad push')
      }
      for (const item of msg.items) {
        if (typeof item?.id !== 'string' || !ITEM_ID.test(item.id)) return this.fail(ws, 'Bad item id')
        if (typeof item.data !== 'string' || item.data.length > MAX_ITEM_BYTES) {
          return this.fail(ws, 'Item too large')
        }
      }
      if (this.ctx.storage.sql.databaseSize > MAX_ROOM_BYTES) return this.fail(ws, 'Group is full')

      const added: Row[] = []
      const now = Date.now()
      for (const item of msg.items) {
        const row = this.sql
          .exec<Row>(
            'INSERT INTO items (id, data, at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING seq, id, data',
            item.id,
            item.data,
            now,
          )
          .toArray()[0]
        if (row) added.push(row)
      }
      ws.send(JSON.stringify({ t: 'ack', ids: msg.items.map((i) => i.id) }))
      if (added.length > 0) {
        const frame = JSON.stringify({ t: 'items', items: added, live: true })
        for (const other of this.ctx.getWebSockets()) if (other !== ws) other.send(frame)
        if (msg.notify === true) await this.wake()
      }
      return
    }

    if (msg.t === 'subscribe' || msg.t === 'unsubscribe') {
      if (!isPushEndpoint(msg.endpoint, this.env)) return this.fail(ws, 'Not a push service')
      if (msg.t === 'unsubscribe') {
        this.sql.exec('DELETE FROM subs WHERE endpoint = ?', msg.endpoint)
        ws.serializeAttachment({})
        return
      }
      const count = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM subs').one().n
      const known = this.sql.exec('SELECT 1 FROM subs WHERE endpoint = ?', msg.endpoint).toArray().length > 0
      if (!known && count >= MAX_SUBSCRIPTIONS) return this.fail(ws, 'Too many phones')
      this.sql.exec(
        'INSERT INTO subs (endpoint, at) VALUES (?, ?) ON CONFLICT(endpoint) DO UPDATE SET at = excluded.at',
        msg.endpoint,
        Date.now(),
      )
      ws.serializeAttachment({ endpoint: msg.endpoint, at: Date.now() } satisfies Attachment)
      return
    }

    if (msg.t === 'away' || msg.t === 'here') {
      const was = (ws.deserializeAttachment() as Attachment | null) ?? {}
      if (was.endpoint) ws.serializeAttachment({ ...was, at: Date.now(), away: msg.t === 'away' } satisfies Attachment)
      return
    }

    this.fail(ws, 'Unknown message')
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, reason)
  }

  /**
   * Wakes the phones subscribed to this room that don't have the app open.
   * Open ones already got the items live and show their own banner. A
   * connection can outlive the app being open (a phone put away keeps its
   * socket for a while), so it only counts while it's pinging and not away.
   */
  private async wake() {
    const now = Date.now()
    const live = new Set(
      this.ctx
        .getWebSockets()
        .flatMap((s) => {
          const a = (s.deserializeAttachment() as Attachment | null) ?? {}
          const pinged = this.ctx.getWebSocketAutoResponseTimestamp(s)?.getTime() ?? 0
          const heard = Math.max(a.at ?? 0, pinged)
          return a.endpoint && !a.away && now - heard < LIVE_MS ? [a.endpoint] : []
        }),
    )
    const subs = this.sql
      .exec<{ endpoint: string }>('SELECT endpoint FROM subs')
      .toArray()
      .filter((s) => !live.has(s.endpoint))
    const results = await Promise.all(subs.map(async (s) => [s.endpoint, await sendPush(s.endpoint, this.env)] as const))
    for (const [endpoint, result] of results) {
      if (result === 'gone') this.sql.exec('DELETE FROM subs WHERE endpoint = ?', endpoint)
    }
  }

  override async alarm(): Promise<void> {
    for (const s of this.ctx.getWebSockets()) s.close(1000, 'Room closed')
    await this.ctx.storage.deleteAll()
    this.setup()
  }

  private page(since: number): Row[] {
    return this.sql
      .exec<Row>('SELECT seq, id, data FROM items WHERE seq > ? ORDER BY seq LIMIT ?', since, PAGE)
      .toArray()
  }

  private isEmpty(): boolean {
    return this.sql.exec('SELECT 1 FROM items LIMIT 1').toArray().length === 0
  }

  private fail(ws: WebSocket, message: string) {
    ws.send(JSON.stringify({ t: 'error', message }))
  }
}
