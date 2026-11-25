import { t } from '@lingui/core/macro'
import { groupBalances } from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { append, deleteGroupLocally, pendingEvents } from '../lib/db.ts'
import { money } from '../lib/format.ts'
import { go, locale, useGroup } from '../lib/hooks.ts'
import { syncHub } from '../lib/sync.ts'

/** You, in one group: your name there, and leaving. */
export function MemberScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [name, setName] = useState<string>()
  const [note, setNote] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [busy, setBusy] = useState(false)

  if (group === undefined) return <main className="screen" />
  if (group === null) {
    go('/')
    return null
  }
  const { meta, state } = group
  const me = state.members.get(meta.meId)
  const savedName = me?.name ?? ''
  const shownName = name ?? savedName
  const groupName = state.name ?? meta.name

  // What this person still owes or is owed, in every currency.
  const open = [...groupBalances(state)].flatMap(([currency, byPerson]) => {
    const amount = byPerson.get(meta.meId)
    return amount ? [{ currency, amount }] : []
  })

  async function rename(e: FormEvent) {
    e.preventDefault()
    const clean = shownName.trim()
    if (!clean || clean === savedName) return
    await append(meta, [{ type: 'member.renamed', memberId: meta.meId, name: clean }])
    setName(undefined)
    setNote(t`Saved. Everyone in the group sees the new name.`)
  }

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
      setNote((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <Header title={t`You in this group`} back={`/g/${groupId}`} />
      <div className="form">
        <form className="settings-card" onSubmit={rename}>
          <h2>{t`Your name`}</h2>
          <label className="field">
            <span>{t`Name in ${groupName}`}</span>
            <input value={shownName} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
          </label>
          <button className="button primary" disabled={!shownName.trim() || shownName.trim() === savedName}>
            {t`Save`}
          </button>
          <p className="hint" aria-live="polite">
            {note}
          </p>
        </form>

        <section className="settings-card">
          <h2>{t`Leave the group`}</h2>
          {open.length > 0 ? (
            <p>{stillOpen(open)}</p>
          ) : (
            <p>
              {t`${groupName} leaves this phone, and the others can’t add you to new expenses. Past expenses keep your name. To come back, you’d need a new invite.`}
            </p>
          )}
          <button className="button danger" disabled={open.length > 0 || busy} onClick={leave}>
            {busy ? t`Leaving…` : confirmLeave ? t`Tap again to leave` : t`Leave group`}
          </button>
        </section>
      </div>
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
