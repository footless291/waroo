# footless

Split bills any way you like, track who owes whom, and settle up in bitcoin, all shown in your own currency. No one ever holds your money, and the server can't read your groups.

Status: early development. You can create groups, add expenses with equal, share-based or exact splits, see balances and suggested payments, and mark debts as paid in cash or by bank transfer. Everything is stored on your device. Sync between devices and bitcoin payments come next.

## Principles

- **Non-custodial.** Payments go straight from one person's wallet to another's. Nothing we run holds keys, balances or anything that can spend.
- **Private by design.** A group's history is a signed, encrypted event log. The sync relay stores and forwards it but can't read it. The group key travels in the invite link.
- **Debts stay in fiat.** If you owe ¥4,800, you owe ¥4,800 whatever bitcoin does. Bitcoin amounts are worked out only at the moment you pay, and the rate is recorded with the payment.
- **Bitcoin is optional.** Cash and bank transfers are first-class, so the app works for groups where nobody uses bitcoin.
- **A PWA, not an app-store app.** One codebase that installs from the browser and works offline.

## Layout

| Path | What |
| --- | --- |
| `packages/ledger` | Pure TypeScript ledger with no runtime dependencies: money handling, split methods, balances, settlements, suggested transfers, and the event-log replay. |
| `apps/web` | The PWA: Vite + React, stores each group's event log in IndexedDB, installable and works offline. |

## Development

Requires Node 22.18 or later (for built-in TypeScript type stripping) and pnpm.

```sh
pnpm install
pnpm dev         # runs the app at http://localhost:5173
pnpm test        # runs every package's tests
pnpm typecheck
pnpm build       # production build of the app in apps/web/dist
```

The ledger's tests also run with nothing installed: `cd packages/ledger && node --test "test/**/*.test.ts"`.

## License

Not chosen yet; this will be settled before the first public release. Parts of `packages/ledger` are adapted from [Spliit](https://github.com/spliit-app/spliit) under the MIT License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
