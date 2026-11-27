import { t } from '@lingui/core/macro'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { append, deleteGroupLocally } from '../lib/db.ts'
import { invitesFor, stopInvite } from '../lib/invites.ts'
import { syncHub } from '../lib/sync.ts'
import { CURRENCIES, currencyName } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'

/** The group's name and main currency. Anyone in the group can change them; everyone sees the change. */
export function GroupSettingsScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [name, setName] = useState<string>()
  const [currency, setCurrency] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

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

  // Only a group that's just you can be deleted: anyone else would lose it too.
  const others = [...state.members.values()].filter((m) => !m.left && m.id !== meta.meId)
  const deletable = others.length === 0

  async function remove() {
    setBusy(true)
    // Its invite links lead nowhere now: turn them off, if the relay can be reached.
    for (const invite of await invitesFor(groupId)) {
      if (invite.expiresAt > Date.now()) await stopInvite(invite).catch(() => {})
    }
    syncHub.drop(groupId)
    await deleteGroupLocally(groupId)
    go('/')
  }

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
      {deletable && (
        <section className="form delete-group">
          {confirming ? (
            <>
              <p>{t`Delete “${savedName}” and everything in it? This can’t be undone.`}</p>
              <button className="button danger-fill" onClick={() => void remove()} disabled={busy}>
                {t`Delete group`}
              </button>
              <button className="button outline" onClick={() => setConfirming(false)} disabled={busy}>
                {t`Cancel`}
              </button>
            </>
          ) : (
            <>
              <button className="button danger" onClick={() => setConfirming(true)}>
                {t`Delete group`}
              </button>
              <p className="hint pad">{t`You’re the only one in this group, so you can delete it.`}</p>
            </>
          )}
        </section>
      )}
    </main>
  )
}
