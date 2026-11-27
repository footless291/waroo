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
    const other = [...state.members.values()].find((m) => m.id !== meta.meId && !m.left)
    return other?.name ?? t`New friend`
  }
  return state.name ?? meta.name
}
