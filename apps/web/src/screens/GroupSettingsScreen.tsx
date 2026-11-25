import { t } from '@lingui/core/macro'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { append } from '../lib/db.ts'
import { CURRENCIES, currencyName } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'

/** The group's name and main currency. Anyone in the group can change them; everyone sees the change. */
export function GroupSettingsScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [name, setName] = useState<string>()
  const [currency, setCurrency] = useState<string>()
  const [busy, setBusy] = useState(false)

  if (group === undefined) return <main className="screen" />
  if (group === null) {
    go('/')
    return null
  }
  const { meta, state } = group
  const savedName = state.name ?? meta.name
  const savedCurrency = state.currency ?? meta.currency
  const shownName = name ?? savedName
  const shownCurrency = currency ?? savedCurrency
  const changed = (shownName.trim() && shownName.trim() !== savedName) || shownCurrency !== savedCurrency

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!changed || busy) return
    setBusy(true)
    const next = shownName.trim()
    await append(meta, [
      {
        type: 'group.updated',
        ...(next !== savedName ? { name: next } : {}),
        ...(shownCurrency !== savedCurrency ? { currency: shownCurrency } : {}),
      },
    ])
    go(`/g/${groupId}`)
  }

  return (
    <main className="screen">
      <Header title={t`Group settings`} back={`/g/${groupId}`} />
      <form className="form" onSubmit={save}>
        <label className="field">
          <span>{t`Group name`}</span>
          <input value={shownName} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t`Main currency`}</span>
          <select value={shownCurrency} onChange={(e) => setCurrency(e.target.value)}>
            {[...new Set([savedCurrency, ...CURRENCIES])].map((c) => (
              <option key={c} value={c}>
                {c} · {currencyName(c)}
              </option>
            ))}
          </select>
        </label>
        <p className="hint pad">{t`New expenses start in the main currency. Changing it doesn’t change any expense already added.`}</p>
        <button className="button primary" disabled={!changed || busy}>
          {t`Save`}
        </button>
        <p className="muted">{meta.shared ? t`Everyone in the group sees the change.` : ''}</p>
      </form>
    </main>
  )
}
