import { t } from '@lingui/core/macro'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { groupBalances } from '@waroo/ledger'
import { append, deleteGroupLocally, pendingEvents } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { invitesFor, stopInvite } from '../lib/invites.ts'
import { syncHub } from '../lib/sync.ts'
import { CURRENCIES, currencyName } from '../lib/format.ts'
import { go, locale, useGroup } from '../lib/hooks.ts'

/** The group's name and main currency. Anyone in the group can change them; everyone sees the change. */
export function GroupSettingsScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [name, setName] = useState<string>()
  const [currency, setCurrency] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [leaveNote, setLeaveNote] = useState('')

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

  // What this person still owes or is owed, in every currency.
  const open = [...groupBalances(state)].flatMap(([c, byPerson]) => {
    const amount = byPerson.get(meta.meId)
    return amount ? [{ currency: c, amount }] : []
  })

  async function leave() {
    if (!confirmLeave) {
      setConfirmLeave(true)
      return
    }
    setBusy(true)
    try {
      if (meta.shared) {
        await append(meta, [{ type: 'member.left', memberId: meta.meId }])
        await syncHub.ensure(meta.id)
        // Make sure the others hear about it before the group leaves this phone.
        const deadline = Date.now() + 20_000
        while ((await pendingEvents(meta.id)).length > 0) {
          if (Date.now() > deadline) throw new Error(t`Couldn’t reach Waroo to tell the group. Check your connection and try again.`)
          await new Promise((r) => setTimeout(r, 300))
        }
        syncHub.drop(meta.id)
      }
      await deleteGroupLocally(meta.id)
      go('/')
    } catch (err) {
      setLeaveNote((err as Error).message)
      setBusy(false)
    }
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
      {!deletable && (
        <section className="form delete-group">
          <h2>{t`Leave the group`}</h2>
          <p>
            {open.length > 0
              ? stillOpen(open)
              : t`${savedName} leaves this phone, and the others can’t add you to new expenses. Past expenses keep your name. To come back, you’d need a new invite.`}
          </p>
          <button className="button danger" disabled={open.length > 0 || busy} onClick={() => void leave()}>
            {busy ? t`Leaving…` : confirmLeave ? t`Tap again to leave` : t`Leave group`}
          </button>
          <p className="hint" aria-live="polite">
            {leaveNote}
          </p>
        </section>
      )}
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

/** "You can leave once you’re all square. Right now you owe ¥4,000." */
function stillOpen(open: { currency: string; amount: number }[]) {
  const parts = open.map(({ currency, amount }) => {
    const sum = money(Math.abs(amount), currency)
    return amount > 0 ? t`get back ${sum}` : t`owe ${sum}`
  })
  const what = new Intl.ListFormat(locale(), { type: 'conjunction' }).format(parts)
  return t`You can leave once you’re all square. Right now you ${what}.`
}
