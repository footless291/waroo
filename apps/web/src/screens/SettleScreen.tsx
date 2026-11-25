import { Trans } from '@lingui/react/macro'
import { t } from '@lingui/core/macro'
import { parseAmount, type SettlementMethod } from '@footless/ledger'
import { useState, type FormEvent } from 'react'
import { BitcoinPay } from '../components/BitcoinPay.tsx'
import { Header } from '../components/Header.tsx'
import { Segmented } from '../components/Segmented.tsx'
import { append, newId } from '../lib/db.ts'
import { CURRENCIES, isRemoved, money, toInput } from '../lib/format.ts'
import { go, useGroup } from '../lib/hooks.ts'
import { ledgerText } from '../lib/ledgerText.ts'

const methods = (): { value: SettlementMethod; label: string }[] => [
  { value: 'cash', label: t`Cash` },
  { value: 'bank', label: t`Bank transfer` },
  { value: 'other', label: t`Other` },
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
  // People who left or were removed aren't offered.
  const people = [...state.members.values()].filter((m) => !m.left && !isRemoved(state, m))
  const from = free ? (pickedFrom ?? meta.meId) : (params.get('from') ?? '')
  const to = free
    ? pickedTo && pickedTo !== from
      ? pickedTo
      : (people.find((m) => m.id !== from)?.id ?? '')
    : (params.get('to') ?? '')
  const currency = free ? (pickedCurrency ?? meta.currency) : (params.get('currency') ?? 'JPY')
  const done = free ? `/g/${meta.id}/payments` : `/g/${meta.id}`
  const label = (id: string) => {
    const name = state.members.get(id)?.name ?? ''
    return id === meta.meId ? t`${name} (you)` : name
  }
  const fromName = state.members.get(from)?.name ?? ''
  const toName = state.members.get(to)?.name ?? ''

  let amount = 0
  let problem = ''
  try {
    amount = parseAmount(amountText || '0', currency)
    if (amount <= 0) problem = t`Enter an amount`
  } catch (e) {
    problem = ledgerText((e as Error).message)
  }
  if (!to || from === to) problem = t`Pick two different people`

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
      <Header title={free ? t`Add payment` : t`Settle up`} back={done} />
      <form className="form" onSubmit={record}>
        {free ? (
          <div className="field-row">
            <label className="field grow">
              <span>{t`Who paid`}</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                {people.map((m) => (
                  <option key={m.id} value={m.id}>
                    {label(m.id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>{t`To`}</span>
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
            {from === meta.meId ? (
              <Trans>
                <strong>You</strong> pay <strong>{toName}</strong>
              </Trans>
            ) : to === meta.meId ? (
              <Trans>
                <strong>{fromName}</strong> pays <strong>you</strong>
              </Trans>
            ) : (
              <Trans>
                <strong>{fromName}</strong> pays <strong>{toName}</strong>
              </Trans>
            )}
          </p>
        )}
        {free && (
          <label className="field">
            <span>{t`Currency`}</span>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set([meta.currency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{t`Amount (${currency})`}</span>
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
            ? partial(money(suggested - amount, currency))
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
              <legend>{from === meta.meId ? t`Or mark it as paid another way` : t`Mark it as paid`}</legend>
              <Segmented label={t`Payment method`} options={methods()} value={method} onChange={setMethod} />
            </fieldset>
            <button className="button primary" disabled={!!problem}>
              {t`Mark as paid`}
            </button>
          </>
        )}
      </form>
    </main>
  )
}

function partial(left: string) {
  return t`Partial payment: ${left} will still be owed.`
}
