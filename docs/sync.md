# How sync works

Waroo groups sync between phones through a relay that stores and forwards encrypted changes. The relay can't read a group, can't change it, and can't pretend to be anyone in it. The money itself never touches any of this: it moves from wallet to wallet.

## The pieces

| Piece | Where | What it knows |
| --- | --- | --- |
| Group key | Each member's phone, and invite links after the `#` | Everything: it decrypts the group |
| Signing key | One per person per group, on their phone; the private half can't be exported, even by Waroo | Proves "this change came from Bob's phone" |
| Relay room | Cloudflare Durable Object (`worker/index.ts`) | A list of encrypted blobs, their ids and arrival order. Nothing readable |
| Event log | Each phone, in IndexedDB | The group's full history, verified |

## What happens when you…

**Create a group.** The phone makes a random 256-bit group key and a signing key pair. The first event in the log adds you, with your public key. Nothing leaves the phone yet.

**Invite people.** The group is marked shared, and its whole history is encrypted and sent to the relay room. The room's name is a SHA-256 hash of the group key, so the relay never learns the key. The invite link is `/#/join?g=<group id>&k=<group key>&from=<your id>`. Browsers never send the part after `#` to any server, Cloudflare included.

**Open an invite.** The phone derives the room name from the key, downloads everything, decrypts it and checks every signature, then shows the group name and the people in it (no money). Joining as an existing person adds a `member.claimed` event with the new phone's public key. Joining as someone new adds a `member.added` event for yourself, with your key. Either way the event is signed with that same key.

**Add an expense.** The phone writes an event, signs it with its private key, encrypts it with the group key (AES-GCM, fresh random IV) and sends it. Other phones in the group get it within a second if they're open, or the next time they open the app.

**Go offline.** Changes are saved on the phone and queued. When the connection comes back, the phone catches up on what it missed and sends what it queued. The event log's ordering (Lamport clocks) means every phone ends up with the same result, whatever order things arrive in. If two people edit the same expense at once, the later edit wins and the app says so.

## What the rules guarantee

Every phone checks every event when it rebuilds the group (`packages/ledger/src/events.ts`):

- Each event's signature must match the public key recorded for its author. A change can't be forged in someone else's name, even by someone who has the invite link.
- A person added by someone else can be claimed by one phone only: the first claim wins.
- Only a phone adding itself can attach a key to a new person.
- Once someone has joined from a phone, only they can change their name.
- Leaving (`member.left`) is for the person themselves, and only at a zero balance in every currency. After that they can't write, and nothing can move their balance: no new expenses or payments with them, and no edits or deletions that change what they paid or owe. Edits that leave them untouched are fine.
- Moving to a new phone (`member.rekeyed`) must be signed with the person's current key, and only for themselves. From then on only the new key can write for them; what the old phone wrote before stays.
- Anything that fails to decrypt, fails its signature check, or breaks a rule is ignored and doesn't affect anything else.

## What it doesn't protect against (yet)

- **Invite links work only as long as they're meant to.** A link holds a fresh secret, not the group key. The key waits on the relay, encrypted with that secret, and is handed out only before the link expires (up to a month), once for a one-person link, and never after the inviter turns it off. Someone who got in keeps the key until they're removed (below). Links from before November 21, 2026, which held the key itself, are no longer accepted.
- **A removed phone can still read what came before.** Removal (below) cuts it off from everything new, but it keeps its own copy of the group up to that point.
- **Trusting whoever vouches.** Anyone in a group can vouch for someone's new phone after a loss (below). Everyone sees who vouched, and the old phone is told, but one member could misuse it to take over someone else's place. The app asks the voucher to compare a 4-digit code with the person, in person or on a call.
- **Metadata.** The relay sees when blobs arrive, roughly how big they are, and the IP addresses connecting to a room. It can't read anything else.
- **Deleting everything.** A malicious relay could refuse to store or forward changes. It can't fake or alter them, and every phone keeps its own full copy.

## The relay protocol

A WebSocket at `/relay/rooms/<room id>`, JSON messages:

| From | Message | Meaning |
| --- | --- | --- |
| Phone | `{ "t": "hello", "since": <seq> }` | Send me everything after this position |
| Relay | `{ "t": "items", "items": [{ "seq", "id", "data" }], "upTo", "done" }` | Backlog, in pages; `done` on the last |
| Relay | `{ "t": "items", "items": [...], "live": true }` | Something new from another phone |
| Phone | `{ "t": "push", "items": [{ "id", "data" }] }` | Store these (up to 200, 64 KB each) |
| Relay | `{ "t": "ack", "ids": [...] }` | Stored (duplicates are ignored) |
| Relay | `{ "t": "error", "message" }` | Something was refused |
| Phone | `{ "t": "push", ..., "notify": true }` | As above, and wake the others' phones (the sender decides: payments, joins, new expenses) |
| Phone | `{ "t": "subscribe" \| "unsubscribe", "endpoint" }` | Wake this phone for this room while it isn't connected |
| Phone | `{ "t": "hello", ..., "ephemeral": true }` | A one-off room (moving phones): wiped an hour after it opens. Only honoured on an empty room |

Invites live at `/relay/invites/<id>`, where the id is a hash of the link's secret: `PUT` stores one (encrypted ticket, expiry, uses, hash of a turn-off token), `GET` says whether it still works without using it, `POST …/open` hands out the ticket and counts a use, and `DELETE` with the token turns it off. After it ends, only its state is kept, for 30 days.

`GET /relay/rooms/<room id>/items?since=<seq>` returns one page of the same items over plain HTTP, for the service worker.

Anyone can run their own relay: it's one small Worker. Notifications need a VAPID key pair (`node scripts/vapid.cjs`); without one, everything else works.

## Notifications

The relay can't read a group, so it can't say what happened. A push carries nothing at all: it only wakes the phone. The service worker (`apps/web/src/sw.ts`) then fetches the room's new items over HTTP, decrypts and verifies them with the keys on the phone, saves them, and writes the notification text itself (`apps/web/src/lib/news.ts`). Apple, Google and Mozilla's push services learn only that a wake-up happened.

- Phones with the app open aren't woken: they get the change live and show an in-app banner instead. "Open" means the app is on screen: it pings the room every 20 seconds and says `away`/`here` as it goes to the background and back. A phone put away can keep its connection for minutes, so a connection that's away, or hasn't pinged for 50 seconds, is woken like any other.
- The relay keeps, per room, only push-service URLs. It never learns who they belong to. Dead subscriptions are dropped when the push service says so.
- Only real push services are accepted as endpoints, so the relay can't be aimed at other sites.
- On iPhone and iPad, notifications work only for Waroo added to the Home Screen.

## Removing someone

Anyone in a shared group can remove another person's phone. Their expenses, payments and balance stay; the real person can rejoin with a new invite, claiming the same name.

- `member.removed` clears the person's signing key, so nothing they sign afterwards counts, and records who removed them. If they never owed, were owed or took part, they're also marked as left.
- Every phone has a **box key** per group (ECDH P-256), published with `member.updated.boxKey`. The phone doing the removal makes a new group key, locks a copy to each remaining member's box key (ECDH → HKDF-SHA-256, salt `waroo-rekey-v1`, info = member id → AES-GCM), and writes `group.rekeyed {from, ephemeral, wrapped}` in the **old** room. Then it moves: new key, new room, history copied across (the relay drops duplicates).
- Other phones see the hand-off in the old room, open their copy, and move too. The removed phone can't open one, so the new room is closed to it. Invites the moving phone made are turned off, and opening an invite whose room has a hand-off says it's out of date.
- Phones keep reading rooms they moved away from for 60 days. A phone that hadn't published a box key yet (not opened since this feature) publishes one there when it next opens, and any phone that's moved hands it the current key there. Since the removed phone still holds the old key, two rules close that room to it: what arrives there can't add, claim, recover, remove or move anyone (those events are dropped), and the current key is handed only to people who were in the group, on the same key, when this phone moved on (`previousKeys[].keyed`). Someone who joined in the old room after the change needs a new invite.
- If two people remove someone at once, each phone follows the chain from the oldest room it knows, taking the last hand-off (in the ledger's agreed order) from each room that includes it, so all phones settle on the same key.

## Friends

A friendship is a group of two marked `group.updated.kind: 'friends'`; the ledger refuses a third member. It's made with a one-person invite (the "friend code", good for a week) and shown under Friends, named after the other person on each side. Everything else (expenses, settling up, moving phones, recovery) is the group machinery unchanged. Linking a friend to the same person in other groups, privately over the friendship's own room, is planned.

## Recovering a lost phone

Moving needs the old phone. When it's lost, someone else in the group stands in for it: on the person's page, "Help [name] back in" shows a code (QR, or a link to send). The new phone opens it like a move, both phones show a 4-digit code, and the voucher confirms they match. The voucher's phone then writes `member.recovered {memberId, key}` (signed by the voucher; the ledger refuses it for yourself), which replaces the person's signing key, so the lost phone can't write. Then it gives the group a new key, as for a removal, so the lost phone can't read on, and sends the group and the person's Lightning addresses to the new phone, locked to the new phone's box key as for a move (so the link can travel over chat). Recovery is per group: someone in each group vouches for that group.

## Moving to a new phone

Signing keys can't be copied, so moving doesn't copy them. The old phone shows a QR code holding a fresh secret. The new phone scans it, makes its own signing key and a one-off box key, and says hello with both through a one-off relay room named by, and encrypted with, that secret. Both phones show a 4-digit code made from the secret and those keys; the person confirms on the old phone that they match. Then the old phone writes `member.rekeyed` in each group, waits until the relay has them, and sends the group keys, the Lightning addresses and the Nostr Wallet Connect connections across in one `sealed` message: encrypted with a fresh key that's locked to the hello's box key, so anyone else who has the secret (a glimpse of the QR code, the link in a chat) can't read it. The new phone checks every field, loads each group, checks the hand-over is there, and stores it with its own key; it answers `done` with proof it opened the message, and only then does the old phone remove the groups and those wallet connections, so it can't spend any more. If a second phone answers the same code, the move stops. Wallets only come along to a phone that has none yet: on a phone already in use, a move-in link only adds groups. A browser wallet (WebLN) belongs to the browser and stays. Recovery never sends wallet connections: the voucher doesn't have them, and the person should turn off the lost phone's connection in their wallet's app.

## Testing

`pnpm relay` runs the app and relay locally on port 8787. `pnpm e2e` then drives several browser profiles as different phones: inviting, joining, live updates, offline changes, upgrading groups made before sharing existed, garbage or forged data at the relay, scanning invites, banners, notifications (a fake push service checks the relay's signatures, and Chromium's devtools protocol wakes the service worker), and moving to a new phone.

## Feedback and updates

Settings → Send feedback posts to `/relay/feedback` (`worker/feedback.ts`). A report (bug, idea or other, up to three screenshots shrunk on the phone to 1600px JPEGs, the app's build, language and browser) is emailed to the maintainer through Cloudflare Email Service (to the secret `FEEDBACK_TO`: on the free plan it can only send to a verified address), from feedback@getwaroo.app, with Reply-To set to the person's address if they gave one; nothing about it is stored. Email Routing forwards hello@ to the maintainer's inbox. If someone ticks "email me about updates", their address and language go in the D1 database `waroo`, table `subscribers`. This is the one part of Waroo the server can read, and the form says so. Five sends per minute per IP, 300 a day in all, and only from the app's own pages. Every other `/relay/` request is limited to 300 a minute per IP (per /64 for IPv6).
