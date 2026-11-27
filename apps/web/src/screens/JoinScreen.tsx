import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { roomId } from '../lib/crypto.ts'
import { firstKeys, replay, type GroupState, type LedgerEvent } from '@waroo/ledger'
import { useEffect, useState, type FormEvent } from 'react'
import { Wordmark } from '../components/Header.tsx'
import { Logo } from '../components/icons.tsx'
import { isGroupKey, newSigningKeys } from '../lib/crypto.ts'
import { append, getGroup, newId, publishProfile, replayGroup, saveJoinedGroup, type GroupMeta } from '../lib/db.ts'
import { go } from '../lib/hooks.ts'
import { InviteClosed, openInvite, type InviteTicket } from '../lib/invites.ts'
import { fetchGroup, syncHub } from '../lib/sync.ts'
import { publishFriendLinks, reconnect } from '../lib/friends.ts'

type Loaded = {
  state: GroupState
  received: { event: LedgerEvent; signature: string }[]
  cursor: number
}

const NEW = 'new'

/** True on a phone when this page is open in the browser, not the installed app. */
function inBrowserTab() {
  const standalone =
    matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  return !standalone && matchMedia('(pointer: coarse)').matches
}

export function JoinScreen({ params }: { params: URLSearchParams }) {
  const secret = params.get('i')
  if (secret !== null) return <JoinByInvite key={secret} secret={secret} />
  // Links from before invites could expire held the group key itself. They're no longer accepted.
  return (
    <main className="screen">
      <section className="empty">
        <h2>{t`This invite link is out of date`}</h2>
        <p>{t`It’s from an older version of Waroo. Ask for a new invite link.`}</p>
        <a className="button primary" href="#/">{t`Open Waroo`}</a>
      </section>
    </main>
  )
}

/** Opens an invite link's secret into the group it leads to, if the link still works. */
function JoinByInvite({ secret }: { secret: string }) {
  const [ticket, setTicket] = useState<InviteTicket>()
  const [problem, setProblem] = useState<{ title: string; text: string }>()
  useEffect(() => {
    if (!isGroupKey(secret)) {
      setProblem({ title: t`This link isn’t complete`, text: t`Ask for the invite link again, and open the whole link.` })
      return
    }
    let live = true
    openInvite(secret).then(
      (t) => live && setTicket(t),
      (err: Error) => {
        if (!live) return
        const why = err.message
        if (err instanceof InviteClosed) setProblem({ title: t`This invite doesn’t work any more`, text: t`${why} Ask for a new one.` })
        else setProblem({ title: t`Couldn’t open the invite`, text: why })
      },
    )
    return () => {
      live = false
    }
  }, [secret])

  if (ticket) return <JoinGroup groupId={ticket.g} groupKey={ticket.k} from={ticket.from} pins={ticket.p} />
  return (
    <main className="screen">
      <div className="join-brand">
        <Logo size={32} />
        <Wordmark />
      </div>
      {problem ? (
        <section className="empty">
          <h2>{problem.title}</h2>
          <p>{problem.text}</p>
          <a className="button primary" href="#/">{t`Open Waroo`}</a>
        </section>
      ) : (
        <p className="muted" role="status">{t`Opening the invite…`}</p>
      )}
    </main>
  )
}

function JoinGroup({ groupId, groupKey: key, from, pins }: { groupId: string; groupKey: string; from: string; pins?: Record<string, string> }) {
  const valid = /^[0-9a-f-]{36}$/.test(groupId) && isGroupKey(key)

  const [loaded, setLoaded] = useState<Loaded>()
  const [problem, setProblem] = useState('')
  const [picked, setPicked] = useState<string>()
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!valid) return
    let live = true
    ;(async () => {
      const existing = await getGroup(groupId)
      if (existing) {
        // The id alone doesn't make it the same group: an invite names both.
        if (existing.key === key || existing.previousKeys?.some((p) => p.key === key)) {
          // A friend you'd removed sent you a new code: the friendship comes back, history and all.
          const before = await replayGroup(groupId)
          if (existing.friend && before.members.get(existing.meId)?.left) {
            await reconnect(existing, before.members.get(existing.meId)!.name)
          }
          go(`/g/${groupId}`)
        }
        else if (live) setProblem(t`This phone already has a different group under this invite’s name. Ask for a new link.`)
        return
      }
      try {
        const { received, cursor } = await fetchGroup(key)
        const state = replay(received.map((r) => r.event), { pins })
        if (!live) return
        if (state.members.size === 0) {
          setProblem(t`This invite doesn’t lead to a group. Ask for a new link.`)
          return
        }
        // Someone was removed since this invite was made: the group has a new key.
        const room = await roomId(key)
        const rejected = new Set(state.rejected.map((r) => r.eventId))
        if (received.some((r) => r.event.type === 'group.rekeyed' && r.event.from === room && !rejected.has(r.event.id))) {
          if (live) setProblem(t`This invite is out of date: the group has changed since it was made. Ask for a new link.`)
          return
        }
        setLoaded({ state, received, cursor })
        const firstFree = [...state.members.values()].find((m) => !m.key && !m.left)
        setPicked(firstFree?.id ?? NEW)
      } catch (e) {
        const why = (e as Error).message
        if (live) setProblem(t`${why}. Check your connection and try again.`)
      }
    })()
    return () => {
      live = false
    }
  }, [groupId, key, valid])

  if (!valid) {
    return (
      <main className="screen">
        <section className="empty">
          <h2>{t`This link isn’t complete`}</h2>
          <p>{t`Ask for the invite link again, and open the whole link.`}</p>
          <a className="button primary" href="#/">{t`Open Waroo`}</a>
        </section>
      </main>
    )
  }

  const state = loaded?.state
  const name = state?.name ?? t`a group`
  const inviter = state?.members.get(from)?.name
  const canJoin = picked && (picked !== NEW || newName.trim()) && !busy

  async function join(e: FormEvent) {
    e.preventDefault()
    if (!loaded || !canJoin) return
    setBusy(true)
    const { keys, publicKey } = await newSigningKeys()
    const meId = picked === NEW ? newId() : picked!
    const group: GroupMeta = {
      id: groupId,
      name: loaded.state.name ?? t`Group`,
      currency: loaded.state.currency ?? 'JPY',
      meId,
      createdAt: new Date().toISOString(),
      key,
      signing: keys,
      publicKey,
      shared: true,
      cursor: loaded.cursor,
      pins: { ...firstKeys(loaded.received.map((r) => r.event), loaded.state), ...pins },
      ...(loaded.state.kind === 'friends' ? { friend: true } : {}),
    }
    await saveJoinedGroup(group, loaded.received)
    await append(group, [
      picked === NEW
        ? { type: 'member.added', member: { id: meId, name: newName.trim(), key: publicKey } }
        : { type: 'member.claimed', memberId: meId, key: publicKey },
    ])
    await publishProfile(groupId)
    await syncHub.ensure(groupId)
    void publishFriendLinks()
    go(`/g/${groupId}?joined=1`)
  }

  return (
    <main className="screen">
      <div className="join-brand">
        <Logo size={32} />
        <Wordmark />
      </div>
      {problem ? (
        <section className="empty">
          <h2>{t`Couldn’t open the group`}</h2>
          <p>{problem}</p>
        </section>
      ) : !state ? (
        <p className="muted" role="status">{t`Opening the group…`}</p>
      ) : state.kind === 'friends' ? (
        <form className="form" onSubmit={join}>
          <div className="join-title">
            <p className="muted">{t`Friend request`}</p>
            <h1>{inviter ? t`${inviter} wants to add you as a friend` : t`Someone wants to add you as a friend`}</h1>
          </div>
          {[...state.members.values()].filter((m) => !m.left).length >= 2 ? (
            <p className="notice">{t`This friend code has been used already. Ask for a new one.`}</p>
          ) : (
            <>
              <p className="muted">{t`You’ll be able to split costs with each other and settle up, without making a group.`}</p>
              <label className="field">
                <span>{t`Your name, as they know you`}</span>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="given-name" maxLength={80} />
              </label>
              <button className="button primary" disabled={!canJoin}>
                {inviter ? t`Add ${inviter} as a friend` : t`Add as a friend`}
              </button>
            </>
          )}
        </form>
      ) : (
        <form className="form" onSubmit={join}>
          <div className="join-title">
            <p className="muted">{inviter ? t`${inviter} invited you to` : t`You’re invited to`}</p>
            <h1>{name}</h1>
          </div>
          <fieldset className="field">
            <legend className="join-legend">{t`Which one are you?`}</legend>
            <div className="choices">
              {[...state.members.values()].filter((m) => !m.left).map((m) => (
                <label key={m.id} className={`choice${m.key ? ' taken' : ''}`}>
                  <input
                    type="radio"
                    name="who"
                    value={m.id}
                    checked={picked === m.id}
                    disabled={!!m.key}
                    onChange={() => setPicked(m.id)}
                  />
                  <span className="choice-text">
                    <strong>{m.name}</strong>
                    {m.key && <span className="muted">{t`Already joined on another phone`}</span>}
                  </span>
                </label>
              ))}
              <label className="choice">
                <input type="radio" name="who" value={NEW} checked={picked === NEW} onChange={() => setPicked(NEW)} />
                <span className="choice-text">
                  <strong>{t`Someone else`}</strong>
                  <span className="muted">{t`Add yourself as a new person`}</span>
                </span>
              </label>
            </div>
          </fieldset>
          {picked === NEW && (
            <label className="field">
              <span>{t`Your name`}</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="given-name" />
            </label>
          )}
          <button className="button primary" disabled={!canJoin}>
            {picked === NEW ? t`Join the group` : joinAs(state.members.get(picked ?? '')?.name ?? '')}
          </button>
          <p className="muted">{t`You’ll see the group’s expenses once you join. No account or sign-up needed.`}</p>
          {inBrowserTab() && (
            <p className="notice">
              {t`Have Waroo on your Home Screen? Join from there instead: open it, tap the scan button and scan the invite code. Groups joined here stay in this browser.`}
            </p>
          )}
        </form>
      )}
    </main>
  )
}

const joinAs = (name: string) => t`Join as ${name}`
