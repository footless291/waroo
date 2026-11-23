import { groupBalances } from '@footless/ledger'
import { useState } from 'react'
import { Avatar } from '../components/Avatar.tsx'
import { Header } from '../components/Header.tsx'
import { money } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { removeMember } from '../lib/rekey.ts'

/** Someone else in a group: where they stand, and removing their phone. */
export function PersonScreen({ groupId, memberId }: { groupId: string; memberId: string }) {
  const group = useGroup(groupId)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')

  if (group === undefined) return <main className="screen" />
  if (group === null) {
    go('/')
    return null
  }
  const { meta, state } = group
  const person = state.members.get(memberId)
  if (!person || memberId === meta.meId) {
    go(`/g/${groupId}`)
    return null
  }
  const groupName = state.name ?? meta.name
  const me = state.members.get(meta.meId)
  const canRemove = state.signed && person.key !== undefined && !person.left && me?.key !== undefined
  // Anyone who's joined on a phone (or was removed) can be vouched back in.
  const canRecover = state.signed && !person.left && me?.key !== undefined && (person.key !== undefined || !!person.removedBy)
  const remover = person.removedBy ? state.members.get(person.removedBy)?.name : undefined
  const balances = [...groupBalances(state)].flatMap(([currency, byPerson]) => {
    const amount = byPerson.get(memberId)
    return amount ? [{ currency, amount }] : []
  })

  async function remove() {
    if (!confirm) {
      setConfirm(true)
      return
    }
    setBusy(true)
    setProblem('')
    try {
      await removeMember(groupId, memberId)
      go(`/g/${groupId}`)
    } catch (err) {
      setProblem((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <main className="screen">
      <Header title={person.name} back={`/g/${groupId}`} />
      <div className="form">
        <section className="person-summary">
          <Avatar state={state} id={memberId} />
          <p>
            {person.left
              ? person.removedBy
                ? `Removed by ${remover ?? 'someone'}.`
                : 'Left the group.'
              : person.removedBy
                ? `Removed by ${remover ?? 'someone'}. Their expenses stay, and they can join again as ${person.name} with a new invite.`
                : person.key
                  ? `In ${groupName} on their phone.`
                  : `Hasn’t joined on a phone yet.`}
          </p>
          {balances.length > 0 && (
            <p className="muted">
              {balances
                .map(({ currency, amount }) => `${amount > 0 ? 'Gets back' : 'Owes'} ${money(Math.abs(amount), currency)}`)
                .join(', ')}
            </p>
          )}
        </section>

        {canRecover && (
          <section className="settings-card">
            <h2>Lost their phone?</h2>
            <p>
              Vouch for {person.name}’s new phone, so they’re back in as themselves. The lost phone stops working in
              this group.
            </p>
            <a className="button outline" href={`#/g/${groupId}/m/${memberId}/recover`}>
              Help {person.name} back in
            </a>
          </section>
        )}

        {canRemove && (
          <section className="settings-card">
            <h2>Remove from the group</h2>
            <p>
              {person.name}’s phone stops getting anything new from {groupName}, and can’t add to it. What they’ve
              added and what they owe stay. Footless gives the group a new key, so everyone else’s phones move over by
              themselves.
            </p>
            {problem && (
              <p className="problems" role="alert">
                {problem}
              </p>
            )}
            <button className="button danger" disabled={busy} onClick={remove}>
              {busy ? 'Removing…' : confirm ? `Tap again to remove ${person.name}` : `Remove ${person.name}`}
            </button>
          </section>
        )}
      </div>
    </main>
  )
}
