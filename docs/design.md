# Footless design system

Footless should feel calm, plain and trustworthy: a place where money between friends gets sorted without fuss. It is not a crypto app, and nothing in the main flows should look or sound like one.

The tokens live as CSS variables at the top of `apps/web/src/styles.css`. Use the variables, never raw values.

## Colour

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--paper` | `#f6f4ef` | `#131815` | Page background |
| `--card` | `#fffdf9` | `#1b211d` | Raised surfaces: lists, cards, inputs |
| `--brand` | `#1f3a2e` | `#cfe3d6` | Primary buttons, logo, selected states |
| `--on-brand` | `#f6f4ef` | `#131815` | Text on `--brand` |
| `--text` | `#1d2420` | `#e8ebe8` | Body text |
| `--muted` | `#5c635e` | `#a8b1ab` | Secondary text, labels |
| `--line` | `#e4e0d6` | `#2c342f` | Dividers; track of tabs and segmented controls |
| `--field-border` | `#8a8378` | `#6d7770` | Borders of inputs and other controls |
| `--owed` / `--owes` | green / rust | lighter tints | Money owed to someone / by someone |
| `--danger` | `#b3261e` | `#ff8a80` | Errors and destructive actions |
| `--accent` | `#e9a23b` | same | Bitcoin moments only (see below) |
| `--focus` | `= --brand` | `= --accent` | Keyboard focus ring |

Rules:

- Text meets WCAG AA (4.5:1) on every surface it appears on, and control borders meet 3:1. Check any new pair before using it.
- Owed and owes are never shown by colour alone; the words "gets back" and "owes" always appear too.
- **Amber is reserved for bitcoin.** It marks the places where bitcoin is involved (the pay-with-bitcoin card, later the wallet), so it stays meaningful. Don't use it for general emphasis.

## Type

One family: the system UI font, falling back to Hiragino Sans and Noto Sans JP so Japanese renders well. Sizes: `--text-sm` 14px (hints), `--text-md` 16px (body, never smaller for inputs, or iOS zooms in), `--text-lg` 20px (screen titles), `--text-xl` 24px (amounts being entered). Amounts use tabular figures so columns line up.

## Space, shape, size

- Spacing on a 4px grid: `--space-1` to `--space-6` (4, 8, 12, 16, 24px).
- Corners: `--radius` 14px for cards and lists, `--radius-sm` 10px for small controls.
- Every tappable thing is at least `--target` (44px) in both directions.
- One column, max 560px wide, comfortable at 320px.

## Components

| Component | Notes |
| --- | --- |
| Header | Back button (or logo on the home screen) and the screen title. The title takes focus on each new screen so screen readers announce it. |
| Tabs | Group sections. Links with `aria-current="page"`. |
| Segmented control | `components/Segmented.tsx`. Native radio inputs, so one tab stop and arrow keys work. Use for 2–4 mutually exclusive options. |
| List rows | Card-backed list, divider between rows, chevron when the row opens something. |
| Buttons | Primary (brand fill), default (card), small, danger (red text). One primary button per screen. |
| Floating action | The single most common action on a screen ("Add expense", "New group"). |
| Live regions | Hints and errors sit in elements with `aria-live="polite"` that are always present, even when empty. |

## Voice

- **Plain words.** "Settle up", "gets back", "owes", "mark as paid". Never "invoice", "sats", "Lightning", "node" or "wallet address" in main flows; those can appear in details for people who look.
- **Amounts in the person's currency, always.** Bitcoin amounts appear only in a payment's details and exports.
- **Talk to the person.** "You owe", "Bob pays you". Lower-case "you" mid-sentence.
- **Short and specific errors.** Say what's wrong in money terms: "¥5,000 left to assign", not "Exact amounts total 5000, expected 10000".
- **Calm about money.** No exclamation marks, no urgency, no red for debts (red is for errors only).
