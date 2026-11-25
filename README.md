# Waroo

At [getwaroo.app](https://getwaroo.app). Formerly Footless: the code, package names and repository still use that name.

Split bills any way you like, track who owes whom, and settle up in bitcoin, all shown in your own currency. No one ever holds your money, and the server can't read your groups.

Status: early development. You can create groups, invite friends with a link, and everyone adds expenses from their own phone, with changes syncing live and end-to-end encrypted. Splits can be equal, by shares, by percentage or exact. Invite links can be for one person, expire, and be turned off. Debts can be settled in bitcoin straight from your wallet to theirs, verified automatically, or marked as paid in cash or by bank transfer. Notifications tell you when someone pays you, joins or adds an expense, and you can move everything to a new phone.

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
| `worker` | The Cloudflare Worker: serves the app, runs the sync relay (one Durable Object per group) and the bitcoin price endpoint. |
| `docs` | [How sync works](docs/sync.md), [paying in bitcoin](docs/payments.md), [design system](docs/design.md). |
| `e2e` | Browser tests that act as several phones at once. |

## Development

Requires Node 22.18 or later (for built-in TypeScript type stripping) and pnpm.

```sh
pnpm install
pnpm dev         # the app alone at http://localhost:5173 (no sync)
pnpm build       # production build of the app in apps/web/dist
pnpm relay       # app + sync relay at http://127.0.0.1:8787 (serves the last build)
pnpm test        # unit tests
pnpm typecheck
pnpm e2e         # multi-phone browser tests; needs `pnpm relay` running
pnpm splash      # remake the iOS launch images after changing the logo
```

The ledger's tests also run with nothing installed: `cd packages/ledger && node --test "test/**/*.test.ts"`.

## License

Not chosen yet; this will be settled before the first public release. Parts of `packages/ledger` are adapted from [Spliit](https://github.com/spliit-app/spliit) under the MIT License; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
