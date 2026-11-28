import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { groupBalances } from '@waroo/ledger'
import { useState } from 'react'
import { Avatar } from '../components/Avatar.tsx'
import { RemoveFriend } from './FriendsScreen.tsx'
import { Header } from '../components/Header.tsx'
import { money } from '../lib/format.ts'
import { groupTitle } from '../lib/title.ts'
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
  const groupName = groupTitle(state, meta)
  const me = state.members.get(meta.meId)
  const canRemove = state.signed && person.key !== undefined && !person.left && me?.key !== undefined
  // Anyone who's joined on a phone (or was removed) can be vouched back in.
  const canRecover = state.signed && !person.left && me?.key !== undefined && (person.key !== undefined || !!person.removedBy)
  const who = person.name
  const by = (person.removedBy ? state.members.get(person.removedBy)?.name : undefined) ?? t`someone`
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
                ? t`Removed by ${by}.`
                : t`Left the group.`
              : person.removedBy
                ? t`Removed by ${by}. Their expenses stay, and they can join again as ${who} with a new invite.`
                : person.key
                  ? state.kind === 'friends'
                    ? t`Connected with you on Waroo.`
                    : t`In ${groupName} on their phone.`
                  : t`Hasn’t joined on a phone yet.`}
          </p>
          {balances.length > 0 && (
            <p className="muted">
              {balances
                .map(({ currency, amount }) => {
                  const sum = money(Math.abs(amount), currency)
                  return amount > 0 ? t`Gets back ${sum}` : t`Owes ${sum}`
                })
                .join(t`, `)}
            </p>
          )}
        </section>

        {canRecover && (
          <section className="settings-card">
            <h2>{t`Lost their phone?`}</h2>
            <p>
              {t`Vouch for ${who}’s new phone, so they’re back in as themselves. The lost phone stops working in this group.`}
            </p>
            <a className="button outline" href={`#/g/${groupId}/m/${memberId}/recover`}>
              {t`Help ${who} back in`}
            </a>
          </section>
        )}

        {state.kind === 'friends' && <RemoveFriend friendship={meta} state={state} />}

        {canRemove && state.kind !== 'friends' && (
          <section className="settings-card">
            <h2>{t`Remove from the group`}</h2>
            <p>
              {t`${who}’s phone stops getting anything new from ${groupName}, and can’t add to it. What they’ve added and what they owe stay. Waroo gives the group a new key, so everyone else’s phones move over by themselves.`}
            </p>
            {problem && (
              <p className="problems" role="alert">
                {problem}
              </p>
            )}
            <button className="button danger" disabled={busy} onClick={remove}>
              {busy ? t`Removing…` : confirm ? t`Tap again to remove ${who}` : t`Remove ${who}`}
            </button>
          </section>
        )}
      </div>
    </main>
  )
}
