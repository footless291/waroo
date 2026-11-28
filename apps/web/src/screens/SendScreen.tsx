import { t } from '@lingui/core/macro'
import { groupBalances, parseAmount, type BitcoinProof } from '@waroo/ledger'
import { useState, type FormEvent } from 'react'
import { BitcoinPay } from '../components/BitcoinPay.tsx'
import { Header } from '../components/Header.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId, type Draft } from '../lib/db.ts'
import { CURRENCIES, money, toInput } from '../lib/format.ts'
import { friendIn } from '../lib/friends.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { ledgerText } from '../lib/ledgerText.ts'

/** Why money's going to a friend, which decides what it does to the balance. */
type Purpose = 'gift' | 'loan' | 'bought'

const purposes = (): { value: Purpose; label: string }[] => [
  { value: 'gift', label: t`Just sending` },
  { value: 'loan', label: t`Lending` },
  { value: 'bought', label: t`Paying for something` },
]

function purposeHint(purpose: Purpose, name: string) {
  if (purpose === 'gift') return t`A gift, or anything outside Waroo. Your balance with ${name} doesn’t change.`
  if (purpose === 'loan') return t`${name} will owe you this back.`
  return t`${name} paid for something of yours. It’s recorded as an expense they paid and your payment to them, so the balance doesn’t change, but your history shows what it was for.`
}

/**
 * Sending a friend money, straight to their wallet: as a gift, a loan, or
 * paying them for something. Opened with ?request=<id>, it pays what they
 * asked for.
 */
export function SendScreen({ groupId, params }: { groupId: string; params: URLSearchParams }) {
  const group = useGroup(groupId)
  const requestId = params.get('request')
  const [amountText, setAmountText] = useState<string>()
  const [pickedCurrency, setCurrency] = useState<string>()
  const [note, setNote] = useState('')
  const [purpose, setPurpose] = useState<Purpose>('gift')
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(false)

  if (!group) return <main className="screen" />
  const { meta, state } = group
  const friend = friendIn(state, meta.meId)
  if (state.kind !== 'friends' || !friend) {
    go(`/g/${groupId}`)
    return null
  }
  const request = requestId ? state.requests.get(requestId) : undefined
  const asked = request && request.to === meta.meId && !request.outcome ? request : undefined
  const currency = asked?.currency ?? pickedCurrency ?? state.currency ?? meta.currency
  const shownAmount = amountText ?? (asked ? toInput(asked.amount, asked.currency) : '')
  const name = friend.name

  let amount = 0
  let problem = ''
  try {
    amount = parseAmount(shownAmount || '0', currency)
    if (amount <= 0) problem = t`Enter an amount`
  } catch (e) {
    problem = ledgerText((e as Error).message)
  }
  if (purpose === 'bought' && !note.trim() && !asked) problem = problem || t`Say what it was for`

  /** What to write once the money's gone. */
  function drafts(bitcoin: BitcoinProof): Draft[] {
    const close: Draft[] = asked ? [{ type: 'request.closed', requestId: asked.id, outcome: 'paid' }] : []
    const label = note.trim() || asked?.note || undefined
    const settle = (): Draft => ({
      type: 'settlement.recorded',
      settlement: { id: newId(), from: meta.meId, to: friend!.id, amount, currency, method: 'bitcoin', bitcoin, ...(label ? { note: label } : {}) },
    })
    if (asked) return [asked.settles ? settle() : { type: 'money.sent', sent: { id: newId(), from: meta.meId, to: friend!.id, amount, currency, bitcoin, ...(label ? { note: label } : {}) } }, ...close]
    if (purpose === 'loan') return [settle()]
    if (purpose === 'bought') {
      const today = new Date().toISOString().slice(0, 10)
      return [
        {
          type: 'expense.saved',
          expense: { id: newId(), title: note.trim(), total: amount, currency, payers: { [friend!.id]: amount }, split: { kind: 'exact', amounts: { [meta.meId]: amount } }, date: today },
        },
        settle(),
      ]
    }
    return [{ type: 'money.sent', sent: { id: newId(), from: meta.meId, to: friend!.id, amount, currency, bitcoin, ...(label ? { note: label } : {}) } }]
  }

  function next(e: FormEvent) {
    e.preventDefault()
    if (!problem) setReady(true)
  }

  return (
    <main className="screen">
      <Header title={asked ? t`Pay ${name}` : t`Send money to ${name}`} back={`/g/${groupId}`} />
      {!ready ? (
        <form className="form" onSubmit={next}>
          {asked && (
            <p className="lead">
              {asked.note ? t`${name} asked you for ${money(asked.amount, asked.currency)}: ${asked.note}` : t`${name} asked you for ${money(asked.amount, asked.currency)}.`}
            </p>
          )}
          <div className="field-row">
            <label className="field grow">
              <span>{t`Amount`}</span>
              <input className="amount-input" value={shownAmount} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="0" readOnly={!!asked} />
            </label>
            <label className="field">
              <span>{t`Currency`}</span>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={!!asked}>
                {[...new Set([currency, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          {!asked && (
            <>
              <fieldset className="field">
                <legend>{t`What’s it for?`}</legend>
                <Segmented label={t`What’s it for?`} options={purposes()} value={purpose} onChange={setPurpose} />
                <p className="hint">{purposeHint(purpose, name)}</p>
              </fieldset>
              <label className="field">
                <span>{purpose === 'bought' ? t`What was it?` : t`Note (optional)`}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={purpose === 'gift' ? t`Happy birthday!` : purpose === 'bought' ? t`Concert ticket` : ''} />
              </label>
            </>
          )}
          <button className="button primary" disabled={!!problem}>
            {t`Next`}
          </button>
          <p className="hint" aria-live="polite">
            {shownAmount ? problem : ''}
          </p>
        </form>
      ) : (
        <section className="form">
          <p className="lead">{t`${money(amount, currency)} to ${name}, straight to their wallet.`}</p>
          <BitcoinPay
            meta={meta}
            state={state}
            to={friend.id}
            amount={amount}
            currency={currency}
            drafts={drafts}
            onRecorded={() => setDone(true)}
            onPaid={() => setDone(true)}
          />
          {done ? (
            <a className="button outline" href={`#/g/${groupId}`}>
              {t`Done`}
            </a>
          ) : (
            <button className="link" onClick={() => setReady(false)}>
              {t`Change the amount`}
            </button>
          )}
        </section>
      )}
    </main>
  )
}

/** Asking a friend for money. If they owe you, the request can be for that. */
export function RequestScreen({ groupId }: { groupId: string }) {
  const group = useGroup(groupId)
  const [amountText, setAmountText] = useState<string>()
  const [pickedCurrency, setCurrency] = useState<string>()
  const [note, setNote] = useState('')
  const [settles, setSettles] = useState<boolean>()
  const [busy, setBusy] = useState(false)

  if (!group) return <main className="screen" />
  const { meta, state } = group
  const friend = friendIn(state, meta.meId)
  if (state.kind !== 'friends' || !friend) {
    go(`/g/${groupId}`)
    return null
  }
  const name = friend.name
  // What they owe you, per currency.
  const owed = [...groupBalances(state)].flatMap(([c, byPerson]) => {
    const mine = byPerson.get(meta.meId) ?? 0
    return mine > 0 ? [{ currency: c, amount: mine }] : []
  })
  const firstOwed = owed[0]
  const currency = pickedCurrency ?? firstOwed?.currency ?? state.currency ?? meta.currency
  const owedHere = owed.find((o) => o.currency === currency)
  const paysBack = settles ?? !!owedHere
  const shownAmount = amountText ?? (paysBack && owedHere ? toInput(owedHere.amount, currency) : '')

  let amount = 0
  let problem = ''
  try {
    amount = parseAmount(shownAmount || '0', currency)
    if (amount <= 0) problem = t`Enter an amount`
  } catch (e) {
    problem = ledgerText((e as Error).message)
  }

  async function ask(e: FormEvent) {
    e.preventDefault()
    if (problem || busy) return
    setBusy(true)
    await append(meta, [
      {
        type: 'payment.requested',
        request: {
          id: newId(),
          from: meta.meId,
          to: friend!.id,
          amount,
          currency,
          ...(note.trim() ? { note: note.trim() } : {}),
          ...(paysBack && owedHere ? { settles: true } : {}),
        },
      },
    ])
    go(`/g/${groupId}`)
  }

  return (
    <main className="screen">
      <Header title={t`Ask ${name} for money`} back={`/g/${groupId}`} />
      <form className="form" onSubmit={ask}>
        {owedHere && (
          <fieldset className="field">
            <legend>{t`What for?`}</legend>
            <Segmented
              label={t`What for?`}
              options={[
                { value: 'back', label: t`What they owe you` },
                { value: 'other', label: t`Something else` },
              ]}
              value={paysBack ? 'back' : 'other'}
              onChange={(v) => {
                setSettles(v === 'back')
                setAmountText(undefined)
              }}
            />
            <p className="hint">
              {paysBack ? t`${name} owes you ${money(owedHere.amount, currency)}. Paying settles it.` : t`Money outside your balance, like a gift or a split you didn’t write down.`}
            </p>
          </fieldset>
        )}
        <div className="field-row">
          <label className="field grow">
            <span>{t`Amount`}</span>
            <input className="amount-input" value={shownAmount} onChange={(e) => setAmountText(e.target.value)} inputMode="decimal" placeholder="0" />
          </label>
          <label className="field">
            <span>{t`Currency`}</span>
            <select value={currency} onChange={(e) => { setCurrency(e.target.value); setAmountText(undefined) }}>
              {[...new Set([currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{t`Note (optional)`}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder={t`Pizza last night`} />
        </label>
        <button className="button primary" disabled={!!problem || busy}>
          {t`Ask for ${money(amount, currency)}`}
        </button>
        <p className="hint">{t`${name} gets a notification, and can pay straight from their wallet.`}</p>
      </form>
    </main>
  )
}
