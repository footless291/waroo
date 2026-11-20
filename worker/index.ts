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

export interface Env {
  ASSETS: Fetcher
  ROOMS: DurableObjectNamespace<RelayRoom>
}

/** A room id is base64url of a SHA-256 digest: 43 characters. */
const ROOM_ID = /^[A-Za-z0-9_-]{43}$/
/** Blob ids are the events' own ids (UUIDs), never anything readable. */
const ITEM_ID = /^[A-Za-z0-9_-]{8,64}$/
const MAX_ITEM_BYTES = 64 * 1024
const MAX_ITEMS_PER_PUSH = 200
const MAX_ROOM_BYTES = 25 * 1024 * 1024
const PAGE = 500

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/relay/health') return Response.json({ ok: true })
    if (url.pathname === '/relay/rate') return rate(url)

    const match = /^\/relay\/rooms\/([^/]+)$/.exec(url.pathname)
    if (match) {
      const room = match[1]!
      if (!ROOM_ID.test(room)) return new Response('Bad room id', { status: 400 })
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
 * The price of one bitcoin in a currency, from three independent sources.
 * Fetched here rather than by phones so the price sites never see who's
 * paying. Cached for a minute. Answers only when at least two sources agree
 * within 2%; one source alone is never trusted. Every source's answer is
 * included and logged, so a bad feed is easy to spot.
 */
async function rate(url: URL): Promise<Response> {
  const currency = (url.searchParams.get('currency') ?? '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return Response.json({ error: 'Bad currency' }, { status: 400 })

  const cache = caches.default
  const cacheKey = new Request(`${url.origin}/relay/rate?v=2&currency=${currency}`, { method: 'GET' })
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
  const lower = currency.toLowerCase()
  const quotes = (
    await Promise.all([
      get('CoinGecko', `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${lower}`, (j) => j?.bitcoin?.[lower]),
      // Coinbase echoes the pair back; check it's the one asked for.
      get('Coinbase', `https://api.coinbase.com/v2/prices/BTC-${currency}/spot`, (j) =>
        j?.data?.base === 'BTC' && j?.data?.currency === currency ? j.data.amount : undefined,
      ),
      // Kraken lists one pair per currency it supports, under its own name.
      get('Kraken', `https://api.kraken.com/0/public/Ticker?pair=XBT${currency}`, (j) => {
        const pairs = Object.values(j?.result ?? {}) as { c?: [string, string] }[]
        return pairs.length === 1 ? pairs[0]?.c?.[0] : undefined
      }),
    ])
  ).filter((q): q is Quote => q !== null)

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

type ClientMessage =
  | { t: 'hello'; since: number }
  | { t: 'push'; items: { id: string; data: string }[] }

type Row = { seq: number; id: string; data: string }

export class RelayRoom extends DurableObject<Env> {
  private sql: SqlStorage

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.sql = ctx.storage.sql
    this.sql.exec(`CREATE TABLE IF NOT EXISTS items (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT NOT NULL UNIQUE,
      data TEXT NOT NULL,
      at INTEGER NOT NULL
    )`)
  }

  override async fetch(): Promise<Response> {
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
      // Send the backlog in pages so a big room doesn't make one huge frame.
      let cursor = since
      for (;;) {
        const rows = this.sql
          .exec<Row>('SELECT seq, id, data FROM items WHERE seq > ? ORDER BY seq LIMIT ?', cursor, PAGE)
          .toArray()
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
      }
      return
    }

    this.fail(ws, 'Unknown message')
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, reason)
  }

  private fail(ws: WebSocket, message: string) {
    ws.send(JSON.stringify({ t: 'error', message }))
  }
}
