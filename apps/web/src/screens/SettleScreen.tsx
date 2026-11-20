import { parseAmount, type SettlementMethod } from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { BitcoinPay } from '../components/BitcoinPay.tsx'
import { Header } from '../components/Header.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId } from '../lib/db.ts'
import { money, toInput } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'

const METHODS: { value: SettlementMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
]

export function SettleScreen({ groupId, params }: { groupId: string; params: URLSearchParams }) {
  const group = useGroup(groupId)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const currency = params.get('currency') ?? 'JPY'
  const suggested = Number(params.get('amount') ?? 0)
  const [amountText, setAmountText] = useState(suggested ? toInput(suggested, currency) : '')
  const [method, setMethod] = useState<SettlementMethod>('cash')
  const [paidInBitcoin, setPaidInBitcoin] = useState(false)

  if (!group) return <main className="screen" />
  const { meta, state } = group
  const fromName = from === meta.meId ? 'You' : state.members.get(from)?.name
  const toName = to === meta.meId ? 'you' : state.members.get(to)?.name

  let amount = 0
  let problem = ''
  try {
    amount = parseAmount(amountText || '0', currency)
    if (amount <= 0) problem = 'Enter an amount'
  } catch (e) {
    problem = (e as Error).message
  }

  async function record(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    await append(meta, [
      { type: 'settlement.recorded', settlement: { id: newId(), from, to, amount, currency, method } },
    ])
    go(`/g/${meta.id}`)
  }

  return (
    <main className="screen">
      <Header title="Settle up" back={`/g/${meta.id}`} />
      <form className="form" onSubmit={record}>
        <p className="settle-summary">
          <strong>{fromName}</strong> {from === meta.meId ? 'pay' : 'pays'} <strong>{toName}</strong>
        </p>
        <label className="field">
          <span>Amount ({currency})</span>
          <input
            readOnly={paidInBitcoin}
            className="amount-input"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <p className="hint" aria-live="polite">
          {suggested > 0 && amount > 0 && amount < suggested
            ? `Partial payment: ${money(suggested - amount, currency)} will still be owed.`
            : ''}
        </p>

        {from === meta.meId && (
          <BitcoinPay
            meta={meta}
            state={state}
            to={to}
            amount={problem ? 0 : amount}
            currency={currency}
            onPaid={() => go(`/g/${meta.id}`)}
            onRecorded={() => setPaidInBitcoin(true)}
          />
        )}

        {!paidInBitcoin && (
          <>
            <fieldset className="field">
              <legend>{from === meta.meId ? 'Or mark it as paid another way' : 'Mark it as paid'}</legend>
              <Segmented label="Payment method" options={METHODS} value={method} onChange={setMethod} />
            </fieldset>
            <button className="button primary" disabled={!!problem}>
              Mark as paid
            </button>
          </>
        )}
      </form>
    </main>
  )
}
