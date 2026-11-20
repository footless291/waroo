# How sync works

Footless groups sync between phones through a relay that stores and forwards encrypted changes. The relay can't read a group, can't change it, and can't pretend to be anyone in it. The money itself never touches any of this: it moves from wallet to wallet.

## The pieces

| Piece | Where | What it knows |
| --- | --- | --- |
| Group key | Each member's phone, and invite links after the `#` | Everything: it decrypts the group |
| Signing key | One per person per group, on their phone; the private half can't be exported, even by Footless | Proves "this change came from Bob's phone" |
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

- **Invite links work only as long as they're meant to.** A link holds a fresh secret, not the group key. The key waits on the relay, encrypted with that secret, and is handed out only before the link expires (up to a month), once for a one-person link, and never after the inviter turns it off. Someone who did get in keeps the key, though: removing them would need a new group key (below). Links sent before November 21, 2026 held the key itself; they still work and can't be turned off.
- **Removing someone** would need a new group key. Not built yet.
- **A lost phone** loses that phone's key. Moving needs the old phone in hand, so after a loss the person can't write as themselves again (they could join as someone new). The group's data is safe on everyone else's phone. Recovery vouched for by the rest of the group is a possible next step.
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

- Phones that are connected to the room aren't woken: they get the change live and show an in-app banner instead.
- The relay keeps, per room, only push-service URLs. It never learns who they belong to. Dead subscriptions are dropped when the push service says so.
- Only real push services are accepted as endpoints, so the relay can't be aimed at other sites.
- On iPhone and iPad, notifications work only for Footless added to the Home Screen.

## Moving to a new phone

Signing keys can't be copied, so moving doesn't copy them. The old phone shows a QR code holding a fresh secret. The new phone scans it, makes its own key, and says hello through a one-off relay room named by, and encrypted with, that secret. Both phones show a 4-digit code made from the secret and the new key; the person confirms on the old phone that they match. Then the old phone writes `member.rekeyed` in each group, waits until the relay has them, and sends the group keys and the Lightning address across. The new phone loads each group, checks the hand-over is there, and stores it with its own key. The old phone then removes the groups. If a second phone answers the same code, the move stops. A connected wallet doesn't move: it's reconnected on the new phone.

## Testing

`pnpm relay` runs the app and relay locally on port 8787. `pnpm e2e` then drives several browser profiles as different phones: inviting, joining, live updates, offline changes, upgrading groups made before sharing existed, garbage or forged data at the relay, scanning invites, banners, notifications (a fake push service checks the relay's signatures, and Chromium's devtools protocol wakes the service worker), and moving to a new phone.
