# Translating Footless

Footless speaks English and Japanese. Strings live in the code in English and are translated through [Lingui](https://lingui.dev) catalogs.

## How it works

- **In the code:** text is wrapped as `` t`Add expense` `` (from `@lingui/core/macro`), or `<Trans>…</Trans>` (from `@lingui/react/macro`) when it has links or bold inside. Values go in as `${name}`, so translators can move them: Japanese puts the verb last.
- **Whole sentences only:** never build a sentence from pieces (`'You owe ' + amount`). Write one message per case instead (`You owe {to}`, `{payer} pays you`, …). Plurals use `plural()`.
- **Catalogs:** `apps/web/src/locales/{en,ja}.po`. Run `pnpm --filter @footless/web messages:extract` after changing text; it adds new messages and drops ones that are gone. A message missing from a catalog shows in English.
- **Choosing the language:** the phone's language by default, or the one picked in Settings → Language (saved in localStorage; changing it reloads the app). The app sets `<html lang>` before the first paint, so Japanese text gets Japanese glyphs.
- **Notifications:** the service worker writes them, so it carries both catalogs and uses the language the app last saved in IndexedDB.
- **Money, dates and lists** go through `Intl` in the app's language (`lib/hooks.ts` `locale()`), keeping the phone's regional flavour when it matches (en-GB stays en-GB).
- **Ledger messages:** the ledger package reports problems in English; `lib/ledgerText.ts` turns the ones people can see into the app's language.
- **Names in Japanese** get さん in sentences: `politeName()` is a message with the context "a person’s name, said politely", translated as `{name}さん`.

## Adding a language

1. Add its code to `locales` in `apps/web/lingui.config.ts`, to `Locale`, `LANGUAGES` and `phoneLocale()` in `src/lib/i18n.ts`, to the early script in `index.html`, and to `sw.ts`.
2. Run `messages:extract` and translate the new `.po` file (any PO editor, or Weblate).
3. Run `node e2e/japanese.cjs` as a model: it checks that no English is left on the main screens.

## Japanese conventions

Polite form (です・ます) in sentences, short nouns on buttons and tabs. Terms: 支出 (expense), 支払い (payment), 精算 (settle up), 残高 (balances), 招待 (invite), スマホ (phone), ウォレット (wallet), ライトニングアドレス (Lightning address), sats.
