import type { GroupState } from '@footless/ledger'

/**
 * A friend's initial on their own colour. Colours follow the order people
 * joined the group, which every device agrees on, so Ana is the same colour
 * on everyone's phone.
 */
export function Avatar({ state, id }: { state: GroupState; id: string }) {
  const members = [...state.members.keys()]
  const index = Math.max(0, members.indexOf(id))
  const name = state.members.get(id)?.name ?? '?'
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ background: `var(--friend-${(index % 6) + 1})` }}
    >
      {[...name][0]?.toUpperCase()}
    </span>
  )
}
