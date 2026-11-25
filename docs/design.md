# Waroo design system

Waroo should feel modern, friendly and calm: a place where money between friends gets sorted without fuss. Youthful without being loud. It is not a crypto app, and nothing in the main flows should look or sound like one.

There are two themes, chosen automatically from the phone's setting:

- **Apricot** (light): a warm off-white page, white rows, and the balance card kept dark plum, like a piece of night mode carried into the day.
- **Night market** (dark): deep plum, with peach for the things that matter.

The tokens live as CSS variables at the top of `apps/web/src/styles.css`. Use the variables, never raw values. Mockups: the design canvas "Waroo: invite and join flow".

## Colour

| Token | Apricot | Night market | Use |
| --- | --- | --- | --- |
| `--paper` | `#fff5ee` | `#16121f` | Page |
| `--card` | `#ffffff` | `#221c2e` | Rows, inputs, chips |
| `--hero` | `#2a1f38` | `#221c2e` | The balance card; the bitcoin card |
| `--hero-number` | `#ffb38a` | `#ffb38a` | The big amount on the hero |
| `--text` | `#2a1f38` | `#f5f0fa` | Body text |
| `--muted` | `#6e5f66` | `#b3a9c2` | Secondary text, labels |
| `--line` | `#f1e3d8` | `#2f2740` | Track of tabs and segmented controls |
| `--field-border` | `#8f7d76` | `#857a93` | Input and outline-button borders (3:1+) |
| `--primary` / `--on-primary` | peach `#ffb38a` / `#2a1a12` | same | The main action on a screen |
| `--strong` / `--on-strong` | plum / white | near-white / plum | Floating "add" button, toasts |
| `--owed` / `--owes` | `#11795a` / `#bf4a33` | `#7fe0b8` / `#ff9c8a` | Money owed to / by someone |
| `--danger` | `#b3261e` | `#ff8a80` | Errors and destructive actions |
| `--friend-1…6` | pastels | same | Avatar colours, with `--on-friend` initials |

Rules:

- Text meets WCAG AA (4.5:1) on every surface it appears on, and control borders meet 3:1. Check any new pair before using it.
- Owed and owes are never shown by colour alone; the words "gets back" and "owes" always appear too.
- **Peach is for the one main action and the hero number.** One peach button per screen.
- **The plum hero surface is special.** It's for the person's own balance and, later, bitcoin moments. Don't use it for ordinary content.
- Friends keep their colour everywhere: colours follow the order people joined, which every phone agrees on.

## Type

One family: **Outfit** (variable, self-hosted, SIL Open Font License), falling back to Hiragino Sans and Noto Sans JP for Japanese. Headings 700, body 400–500, the hero number 800 at 52px with tight tracking. 16px minimum for inputs, or iOS zooms in. Amounts use tabular figures.

## Shape, space, size

- **Everything tappable is a pill.** Rows and cards: 22px corners. The hero: 32px. Inputs: 16px.
- Flat surfaces, no borders on rows, no drop shadows except under the floating button in Apricot.
- Spacing on a 4px grid: 8, 12, 16, 20px. Screen padding 20px.
- Every tappable thing is at least 44px in both directions; main buttons are 52px.
- One column, max 560px wide, comfortable at 320px.

## Components

| Component | Notes |
| --- | --- |
| Header | Round back button (or the logo on the home screen) and the screen title. The title takes focus on each new screen so screen readers announce it. |
| Tabs | Pill track with the current tab raised. Links with `aria-current="page"`. |
| Balance hero | Your own position: avatars, "You owe Ana", the amount, and Settle up when there's one person to pay. Says "You're all square" when you are. |
| People list | Avatar, name, balance; plain rows on the page. |
| Card rows | Expenses, groups, payments: rounded rows with a gap between. |
| Segmented control | `components/Segmented.tsx`. Native radio inputs, so one tab stop and arrow keys work. 2–4 options. |
| Buttons | Primary (peach), default (card), outline, small, danger. All pills. |
| Floating action | The most common action ("Add expense", "New group"), with a plus icon. |
| Live regions | Hints and errors sit in elements with `aria-live="polite"` that are always present, even when empty. |

## Voice

- **Plain words.** "Settle up", "gets back", "owes", "mark as paid". Never "invoice", "sats", "Lightning", "node" or "wallet address" in main flows; those can appear in details for people who look.
- **Amounts in the person's currency, always.** Bitcoin amounts appear only in a payment's details and exports.
- **Talk to the person.** "You owe", "You get back", "Bob pays you". Lower-case "you" mid-sentence; "gets" and "owes" only for other people.
- **Waroo** is always capitalized.
- **Short and specific errors.** Say what's wrong in money terms: "¥5,000 left to assign".
- **Calm about money.** No exclamation marks, no urgency. Red is for errors only; debts use the softer `--owes`.
