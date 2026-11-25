/**
 * The ledger package explains problems in English (it's shared, and has no
 * translations). This turns the ones a person can run into into the app's
 * language. Anything not listed is shown as it is.
 */
import { t } from '@lingui/core/macro'

export function ledgerText(message: string): string {
  let m: RegExpExecArray | null
  if (message === 'A split needs at least one person') return t`Pick at least one person to split it`
  if (message === 'Weights must not all be zero') return t`Give at least one person a share`
  if (message === 'Extras need items that total more than zero') return t`A tax, tip or discount needs items that come to more than zero`
  if (message === 'Someone has to have paid') return t`Say who paid`
  if ((m = /^Not an amount: "(.*)"$/.exec(message))) {
    const input = m[1] ?? ''
    return t`“${input}” isn’t an amount`
  }
  if ((m = /^(\w+) allows at most (\d+) decimal places/.exec(message))) {
    const currency = m[1] ?? ''
    const digits = Number(m[2])
    return digits === 0 ? t`${currency} has no decimal places` : t`${currency} takes at most ${digits} decimal places`
  }
  if (/^Amount too large/.test(message)) return t`That amount is too large`
  if (/^Unknown person/.test(message)) return t`Someone in this expense isn’t in the group`
  return message
}
