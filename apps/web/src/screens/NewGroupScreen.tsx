import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { createGroup } from '../lib/db.ts'
import { CURRENCIES, currencyName } from '../lib/format.ts'
import { go } from '../lib/hooks.ts'

export function NewGroupScreen() {
  const [name, setName] = useState('')
  const [myName, setMyName] = useState('')
  const [others, setOthers] = useState<string[]>([''])
  const [currency, setCurrency] = useState('JPY')
  const [busy, setBusy] = useState(false)

  const otherNames = others.map((o) => o.trim()).filter(Boolean)
  const canSave = name.trim() && myName.trim() && !busy

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSave) return
    setBusy(true)
    const group = await createGroup({ name: name.trim(), myName: myName.trim(), otherNames, currency })
    go(`/g/${group.id}`)
  }

  return (
    <main className="screen">
      <Header title="New group" back="/" />
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Group name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Okinawa trip" autoFocus />
        </label>
        <label className="field">
          <span>Your name</span>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} placeholder="Ana" autoComplete="given-name" />
        </label>
        <fieldset className="field">
          <legend>Who else?</legend>
          {others.map((other, i) => (
            <input
              key={i}
              value={other}
              aria-label={`Person ${i + 2}`}
              placeholder={i === 0 ? 'Bob' : 'Another person'}
              onChange={(e) => {
                const next = [...others]
                next[i] = e.target.value
                if (i === next.length - 1 && e.target.value) next.push('')
                setOthers(next)
              }}
            />
          ))}
          <p className="hint">You can add more people later.</p>
        </fieldset>
        <label className="field">
          <span>Main currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
          </select>
        </label>
        <button className="button primary" disabled={!canSave}>
          Create group
        </button>
      </form>
    </main>
  )
}
