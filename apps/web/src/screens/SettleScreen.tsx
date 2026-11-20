import { parseAmount, type SettlementMethod } from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { BitcoinPay } from '../components/BitcoinPay.tsx'
import { Header } from '../components/Header.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId } from '../lib/db.ts'
import { CURRENCIES, money, toInput } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'

const METHODS: { value: SettlementMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'other', label: 'Other' },
]

export function SettleScreen({ groupId, params }: { groupId: string; params: URLSearchParams }) {
  const group = useGroup(groupId)
  // Opened from "Add payment", nothing is filled in: the person picks who paid whom.
  const free = !params.get('from')
  const [pickedFrom, setFrom] = useState<string>()
  const [pickedTo, setTo] = useState<string>()
  const [pickedCurrency, setCurrency] = useState<string>()
  const suggested = Number(params.get('amount') ?? 0)
  const [amountText, setAmountText] = useState(
    suggested ? toInput(suggested, params.get('currency') ?? 'JPY') : '',
  )
  const [method, setMethod] = useState<SettlementMethod>('cash')
  const [paidInBitcoin, setPaidInBitcoin] = useState(false)

  if (!group) return <main className="screen" />
  const { meta, state } = group
  const people = [...state.members.values()].filter((m) => !m.left)
  const from = free ? (pickedFrom ?? meta.meId) : (params.get('from') ?? '')
  const to = free
    ? pickedTo && pickedTo !== from
      ? pickedTo
      : (people.find((m) => m.id !== from)?.id ?? '')
    : (params.get('to') ?? '')
  const currency = free ? (pickedCurrency ?? meta.currency) : (params.get('currency') ?? 'JPY')
  const done = free ? `/g/${meta.id}/payments` : `/g/${meta.id}`
  const label = (id: string) => (id === meta.meId ? `${state.members.get(id)?.name} (you)` : state.members.get(id)?.name)
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
  if (!to || from === to) problem = 'Pick two different people'

  async function record(e: FormEvent) {
    e.preventDefault()
    if (problem) return
    await append(meta, [
      { type: 'settlement.recorded', settlement: { id: newId(), from, to, amount, currency, method } },
    ])
    go(done)
  }

  return (
    <main className="screen">
      <Header title={free ? 'Add payment' : 'Settle up'} back={done} />
      <form className="form" onSubmit={record}>
        {free ? (
          <div className="field-row">
            <label className="field grow">
              <span>Who paid</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {label(m.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>To</span>
              <select value={to} onChange={(e) => setTo(e.target.value)}>
                {people
                  .filter((m) => m.id !== from)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {label(m.id)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ) : (
          <p className="settle-summary">
            <strong>{fromName}</strong> {from === meta.meId ? 'pay' : 'pays'} <strong>{toName}</strong>
          </p>
        )}
        {free && (
          <label className="field">
            <span>Currency</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([meta.currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
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
            onPaid={() => go(done)}
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
