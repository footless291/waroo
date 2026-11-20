import { replay, type GroupState, type LedgerEvent } from '@footless/ledger'
import { useEffect, useState, type FormEvent } from 'react'
import { Logo } from '../components/icons.tsx'
import { isGroupKey, newSigningKeys } from '../lib/crypto.ts'
import { append, getGroup, newId, publishProfile, saveJoinedGroup, type GroupMeta } from '../lib/db.ts'
import { go } from '../lib/hooks.ts'
import { fetchGroup, syncHub } from '../lib/sync.ts'

type Loaded = {
  state: GroupState
  received: { event: LedgerEvent; signature: string }[]
  cursor: number
}

const NEW = 'new'

export function JoinScreen({ params }: { params: URLSearchParams }) {
  const groupId = params.get('g') ?? ''
  const key = params.get('k') ?? ''
  const from = params.get('from') ?? ''
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
      if (await getGroup(groupId)) {
        go(`/g/${groupId}`)
        return
      }
      try {
        const { received, cursor } = await fetchGroup(key)
        const state = replay(received.map((r) => r.event))
        if (!live) return
        if (state.members.size === 0) {
          setProblem('This invite doesn’t lead to a group. Ask for a new link.')
          return
        }
        setLoaded({ state, received, cursor })
        const firstFree = [...state.members.values()].find((m) => !m.key)
        setPicked(firstFree?.id ?? NEW)
      } catch (e) {
        if (live) setProblem(`${(e as Error).message}. Check your connection and try again.`)
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
          <h2>This link isn’t complete</h2>
          <p>Ask for the invite link again, and open the whole link.</p>
          <a className="button primary" href="#/">Open Footless</a>
        </section>
      </main>
    )
  }

  const state = loaded?.state
  const name = state?.name ?? 'a group'
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
      name: loaded.state.name ?? 'Group',
      currency: loaded.state.currency ?? 'JPY',
      meId,
      createdAt: new Date().toISOString(),
      key,
      signing: keys,
      publicKey,
      shared: true,
      cursor: loaded.cursor,
    }
    await saveJoinedGroup(group, loaded.received)
    await append(group, [
      picked === NEW
        ? { type: 'member.added', member: { id: meId, name: newName.trim(), key: publicKey } }
        : { type: 'member.claimed', memberId: meId, key: publicKey },
    ])
    await publishProfile(groupId)
    await syncHub.ensure(groupId)
    go(`/g/${groupId}?joined=1`)
  }

  return (
    <main className="screen">
      <div className="join-brand">
        <Logo size={32} />
        <span>Footless</span>
      </div>
      {problem ? (
        <section className="empty">
          <h2>Couldn’t open the group</h2>
          <p>{problem}</p>
        </section>
      ) : !state ? (
        <p className="muted" role="status">Opening the group…</p>
      ) : (
        <form className="form" onSubmit={join}>
          <div className="join-title">
            <p className="muted">{inviter ? `${inviter} invited you to` : 'You’re invited to'}</p>
            <h1>{name}</h1>
          </div>
          <fieldset className="field">
            <legend className="join-legend">Which one are you?</legend>
            <div className="choices">
              {[...state.members.values()].map((m) => (
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
                    {m.key && <span className="muted">Already joined on another phone</span>}
                  </span>
                </label>
              ))}
              <label className="choice">
                <input type="radio" name="who" value={NEW} checked={picked === NEW} onChange={() => setPicked(NEW)} />
                <span className="choice-text">
                  <strong>Someone else</strong>
                  <span className="muted">Add yourself as a new person</span>
                </span>
              </label>
            </div>
          </fieldset>
          {picked === NEW && (
            <label className="field">
              <span>Your name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoComplete="given-name" />
            </label>
          )}
          <button className="button primary" disabled={!canJoin}>
            {picked === NEW ? 'Join the group' : `Join as ${state.members.get(picked ?? '')?.name ?? ''}`}
          </button>
          <p className="muted">You’ll see the group’s expenses once you join. No account or sign-up needed.</p>
        </form>
      )}
    </main>
  )
}
