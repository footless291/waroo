import { t } from '@lingui/core/macro'
import { useEffect, useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { createGroup, myLastName } from '../lib/db.ts'
import { connectedFriends, inviteFriendsTo } from '../lib/friends.ts'
import { CURRENCIES, currencyName } from '../lib/format.ts'
import { go, useLoad } from '../lib/hooks.ts'

export function NewGroupScreen() {
  const [name, setName] = useState('')
  const [myName, setMyName] = useState('')
  const [others, setOthers] = useState<string[]>([''])
  const [currency, setCurrency] = useState('JPY')
  const [busy, setBusy] = useState(false)
  const friends = useLoad(connectedFriends, [])
  const [invited, setInvited] = useState<string[]>([])
  useEffect(() => {
    void myLastName().then((n) => setMyName((typed) => typed || n))
  }, [])

  const otherNames = others.map((o) => o.trim()).filter(Boolean)
  const canSave = name.trim() && myName.trim() && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    const group = await createGroup({ name: name.trim(), myName: myName.trim(), otherNames, currency })
    const chosen = (friends ?? []).filter((f) => invited.includes(f.friendship.id)).map((f) => f.friendship)
    try {
      await inviteFriendsTo(group.id, name.trim(), chosen)
    } catch (err) {
      // Offline, say: the group is made; invites can be sent from Invite people.
      console.warn('friend invites', err)
    }
    go(`/g/${group.id}`)
  }

  return (
    <main className="screen">
      <Header title={t`New group`} back="/" />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>{t`Group name`}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t`Okinawa trip`} />
        </label>
        <label className="field">
          <span>{t`Your name`}</span>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder={t`Ana`} autoComplete="given-name" />
        </label>
        <fieldset className="field">
          <legend>{t`Who else?`}</legend>
          {others.map((other, i) => (
            <input
              key={i}
              value={other}
              aria-label={personLabel(i + 2)}
              placeholder={i === 0 ? t`Bob` : t`Another person`}
              onChange={(e) => {
                const next = [...others]
                next[i] = e.target.value
                if (i === next.length - 1 && e.target.value) next.push('')
                setOthers(next)
              }}
            />
          ))}
          <p className="hint">{t`You can add more people later.`}</p>
        </fieldset>
        {friends && friends.length > 0 && (
          <fieldset className="field">
            <legend>{t`Invite friends`}</legend>
            <div className="friend-picks">
              {friends.map((f) => (
                <label key={f.friendship.id} className="check-row">
                  <input
                    type="checkbox"
                    checked={invited.includes(f.friendship.id)}
                    onChange={(e) =>
                      setInvited((list) => (e.target.checked ? [...list, f.friendship.id] : list.filter((id) => id !== f.friendship.id)))
                    }
                  />
                  <span>{f.name}</span>
                </label>
              ))}
            </div>
            <p className="hint">{t`They get an invite privately, and join from their own phone. No need to add them above too.`}</p>
          </fieldset>
        )}
        <label className="field">
          <span>{t`Main currency`}</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={!canSave}>
          {t`Create group`}
        </button>
      </form>
    </main>
  )
}

// Tests find these fields by this label in English, so it stays "Person 2", "Person 3"…
const personLabel = (n: number) => t`Person ${n}`
