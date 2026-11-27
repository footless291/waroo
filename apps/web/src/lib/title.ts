import { t } from '@lingui/core/macro'

/**
 * What to call a group: its name, or for a friendship the other person's
 * name (each side sees the other's).
 */
export function groupTitle(
  state: { kind?: string; name?: string; members: Map<string, { id: string; name: string; left?: boolean }> },
  meta: { meId: string; name: string },
): string {
  if (state.kind === 'friends') {
    const others = [...state.members.values()].filter((m) => m.id !== meta.meId)
    // Whoever's there now; else whoever was (a friend who's disconnected keeps their name).
    const other = others.find((m) => !m.left) ?? others.at(-1)
    return other?.name ?? t`New friend`
  }
  return state.name ?? meta.name
}
