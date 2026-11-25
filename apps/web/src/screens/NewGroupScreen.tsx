import { t } from '@lingui/core/macro'
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
