# @footless/ledger

The bill-splitting core of footless. It is pure TypeScript with no runtime dependencies, so it runs the same in the browser, in a service worker and in Node.

## What's in it

- **Money** (`money.ts`): amounts are integer minor units (yen, cents) plus an ISO currency code. `parseAmount` turns typed text into minor units exactly. `fiatToSats` converts at a quoted bitcoin price and rounds up, so the creditor is never short.
- **Splits** (`splits.ts`): `equal`, `shares`, `percent`, `exact`, `adjustment` and `itemized` (line items plus tax, tip or discounts spread by subtotal). Expenses can have several payers. Shares always add up to exactly the total, never depend on input order, and the leftover yen rotates between people from one expense to the next.
- **Balances** (`balances.ts`): recomputed from expenses and settlements, per currency, never stored. Debts are never converted between currencies. Settlements can carry a bitcoin proof (sats, rate, payment hash, preimage), checked by `verifyPreimage`.
- **Suggested transfers** (`simplify.ts`): a stable, short list of payments that clears everyone.
- **Event log** (`events.ts`): a group's history is a list of events. `replay` rebuilds the same state from them on every device, in any arrival order. It reports concurrent edits as conflicts, and it rejects invalid events and events from non-members instead of throwing.

## Not in it (on purpose)

Signing, encryption, storage and networking belong to the transport layer, which hands `replay` events whose authors it has already verified.

## Tests

```sh
node --test "test/**/*.test.ts"
```
