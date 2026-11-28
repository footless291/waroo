import { t } from '@lingui/core/macro'
import { useState, type FormEvent } from 'react'
import { Header } from '../components/Header.tsx'
import { append } from '../lib/db.ts'
import { groupTitle } from '../lib/title.ts'
import { go, useGroup } from '../lib/hooks.ts'

/** Your name in one group. (Leaving is in the group's settings.) */
export function MemberScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [name, setName] = useState<string>()
  const [note, setNote] = useState('')

  if (group === undefined) return <main className="screen" />
  if (group === null) {
    go('/')
    return null
  }
  const { meta, state } = group
  const savedName = state.members.get(meta.meId)?.name ?? ''
  const shownName = name ?? savedName
  const groupName = groupTitle(state, meta)

  async function rename(e: FormEvent) {
    e.preventDefault()
    const clean = shownName.trim()
    if (!clean || clean === savedName) return
    await append(meta, [{ type: 'member.renamed', memberId: meta.meId, name: clean }])
    setName(undefined)
    setNote(t`Saved. Everyone in the group sees the new name.`)
  }

  return (
    <main className="screen">
      <Header title={t`Your name`} back={`/g/${groupId}`} />
      <form className="form" onSubmit={rename}>
        <label className="field">
          <span>{t`Name in ${groupName}`}</span>
          <input value={shownName} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={80} />
        </label>
        <button className="button primary" disabled={!shownName.trim() || shownName.trim() === savedName}>
          {t`Save`}
        </button>
        <p className="hint" aria-live="polite">
          {note}
        </p>
      </form>
    </main>
  )
}
