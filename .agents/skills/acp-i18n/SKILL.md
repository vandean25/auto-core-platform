---
name: acp-i18n
description: Use when adding or changing user-facing text in ACP (core-web UI, toasts, form validation, enum labels, backend error codes, PDFs, emails), when editing files under locales/{de,en}/, when `npm run i18n:check` or the `i18next/no-literal-string` lint rule fails, or when the user mentions i18n, translation, Übersetzung, locale, de-AT, glossary or legal texts. German (de-AT) is the source of truth.
---

# ACP i18n and translation (DE/EN)

ACP is localized with **i18next + react-i18next**. German (`de`, formatted as `de-AT`) is the source of truth and the default language. English (`en`) is the second language. Every key must exist in both languages.

## Where things live
- `locales/{de,en}/<namespace>.json` (repo root): the translations. Namespaces on disk today: `common`, `nav`, `customers`, `sales`, `vehicles`, `vehicleStock`, `workshop`, `enums`, `errors`, `glossary`.
- `apps/core-web/src/lib/i18n/`: the i18next instance (`init-i18n.ts`), `constants.ts`, lazy loading (`lazy-resources`), Zod locale (`zod-locale`), enum labels (`enum-labels`, `enum-registry`). Import from `@/lib/i18n`.
  - `constants.ts`: `DEFAULT_UI_LANGUAGE = 'de'`, `FORMAT_LOCALE = 'de-AT'`, `DEFAULT_TIME_ZONE = 'Europe/Vienna'`.
  - `PRELOAD_NAMESPACES` and `LAZY_NAMESPACES`: a new namespace must be added there and in both locale folders.
- `apps/core-web/src/lib/format/`: the central formatter. `formatCurrency`, `formatDate`, `formatDateTime`, `formatNumber`, `formatPercent`, `formatMonthYear` and more are exported from `@/lib/format`.
- `tools/i18n-check.mjs` + `tools/i18n-check-lib.mjs`: DE/EN parity and key-usage check. `tools/i18n-check-manifest.json` lists keys that are built dynamically (`usedKeyPrefixes`, `usedKeys`, `treatNamespaceAsUsed`).
- ESLint: `apps/core-web/eslint.config.js` warns on literal strings everywhere. These files make `i18next/no-literal-string` strict for migrated domains:
  - `eslint-shell-i18n.config.js`
  - `eslint-enums-i18n.config.js`
  - `eslint-workshop-i18n.config.js`
  - `eslint-sales-domain-i18n.config.js`
  - shared settings in `eslint-i18n-shared.config.js`
  
  Direct `Intl.*` use is an error outside `src/lib/format/**` (AUT-577).
- Tests: `apps/core-web/src/test/setup.ts` initializes i18n with `language: 'de'`. `apps/core-web/src/test/german-ui.ts` provides `registerGermanUiForTests()`.

## Adding or changing text
1. **Pick the namespace by domain**, not by component:
   - workshop screens → `workshop`
   - used-car stock → `vehicleStock`
   - menu and sidebar → `nav`
   - generic buttons and states (Speichern, Abbrechen, Laden…) → `common`
   - enum values → `enums`
   - error texts → `errors`
   - technical terms → `glossary`
   
   Do not duplicate a `common` text in a domain namespace.
2. **Semantic keys**, camelCase, nested by screen or feature: `workshop:checkIn.signature.title`, never `workshop:text1` or the German sentence as the key.
3. **Write German first**, then English. Both files in the same commit. Keep key order identical in `de` and `en`.
4. **Interpolation** uses `{{name}}`: `t('workshop:order.assigned', { name })`. Never build sentences by string concatenation, because word order differs between DE and EN.
5. **Plurals** use i18next suffixes `_one` / `_other` and pass `count`. Example in `locales/de/workshop.json`: `"hours_one": "{{count}} Std."`. Add `_zero` only when the wording really differs. Never write pseudo-plurals like „Aufgabe(n)“ or „Position(en)“. To convert one, replace the base key with `_one` and `_other` in **both** `de` and `en`. The call `t('ns:key', { count })` stays unchanged, and `i18n:check` treats the plural family as one used key.
6. **Rich text** uses `<Trans>` with named components, not HTML inside strings.
7. **Dynamic keys** (`t(\`enums:status.${value}\`)`): add the prefix to `tools/i18n-check-manifest.json` → `usedKeyPrefixes`, otherwise the check reports the keys as unused.
8. In React use `useTranslation('<ns>')`. Outside components use `i18n.t` from `@/lib/i18n` (toasts in hooks or services, for example).

## Terminology (de-AT)
- Use the terms in `locales/de/glossary.json` (`pickerl`, `kva`, `vehicleCheckIn`, `workshopOrder`, `salesOrder` …) consistently. Do not invent synonyms. For example:
  - always „Kostenvoranschlag (KVA)“, never „Angebot“ for a workshop estimate
  - „Pickerl (§57a)“, not „TÜV“ or „HU“
- Fixed terms (checked in the de-AT cleanup):
  - **FIN**, never „VIN“, in German text (also in labels and placeholders). „VIN“ stays only in EN.
  - **Kundenauftrag** for a sales order (as in `glossary.json` → `salesOrder`), never „Verkaufsauftrag“.
  - An invoice is **ausgestellt** („Rechnung ausstellen“). A vehicle sale is **abgeschlossen**. Never „finalisieren“.
  - Hebebühne (not „Bay“), Annahme / Fahrzeugannahme (not „Check-in“ or „Intake“ in DE copy), Mechaniker (not „Techniker“), Hochladen (not „Upload“ as a verb or in toasts), Zeitraum (not „Fenster“), Originalteile / Zubehör (not „OEM“ / „Aftermarket“), Artikelnummer (not „SKU“).
- Austrian forms: **Jänner** (not Januar), Feber only in informal text (in UI and documents use „Februar“). Use „heuer“ only in informal copy. Month names come from `@/lib/format` with `de-AT`, so never hard-code them.
- New technical terms or abbreviations go into `glossary.json` (de and en) with `short`, `term`, `description`, so the glossary tooltip can explain them.

## Tone and style
- Never „du“. Address rule:
  - **Short hints use the infinitive or a noun phrase.** This covers buttons, labels, placeholders, headings and one-fragment toasts: „Speichern“, „Kunde auswählen“, „E-Mail-Adresse eingeben.“, „Hochladen fehlgeschlagen“.
  - **Full sentences that address the user use the Sie-form.** This covers explanations, error descriptions and any text with more than one sentence: „Bitte laden Sie die Seite neu.“, „Legen Sie zuerst ein Fahrzeug an, um …“.
  - Do not mix both in one string. Wrong: „Speichern fehlgeschlagen. Bitte erneut versuchen.“ Right: „Speichern fehlgeschlagen. Bitte versuchen Sie es erneut.“
- Error messages say what happened and what the user can do: „Das Fahrzeug konnte nicht gespeichert werden. Bitte prüfen Sie die FIN.“
- Retry or conflict wording: „Bitte laden Sie die Seite neu und versuchen Sie es erneut.“ Do not use the bare „Bitte neu laden“ in a full sentence.
- **No technical text in user-facing messages**: no API paths, HTTP status codes, stack traces, field names like `vendor_id`, enum constants or error codes as a prefix (`REGISTRATION_INTAKE_…: …`), UUIDs or IDs, transport terms (Idempotency-Key, Header, Payload, rate limit, Serializer, Outbox, Snapshot), test or seed wording („Synthetisch…“, „UAT-Seed“), role constants (`OWNER`, `ADMIN` → „Inhaber“, „Administratoren“) or English exception text. These belong in logs and Sentry, not in the UI. If the user cannot act on a technical cause, say what to do instead („Bitte laden Sie die Seite neu.“, „Bitte wenden Sie sich an Ihren Administrator.“).
- **No word-by-word machine translation.** Translate the meaning and use the terms from the glossary. Check length, because German is often 30% longer, so test truncation in buttons and table headers. If unsure about a technical term, leave a `TODO(i18n-review)` in the PR description, not in the JSON.
- English copy: plain US English, sentence case, same meaning as German. No German terms in EN except as glossary entries (for example „Pickerl (periodic inspection)“).

## Backend: codes, not texts
- core-api sends **only stable error codes plus params**. Never send translated or German message text to the client. The client maps them to `errors:codes.<CODE>` with interpolation. Unknown codes fall back to a generic error (`errors:generic`).
- **`locales/*/errors.json` is generated. Do not edit it by hand.** Sources and workflow:
  1. German: `tools/error-de-hand-catalog.json` (one hand-written entry per code; generation fails if a code is missing). HTTP/Prisma fallbacks (`HTTP_4xx/5xx`, `PRISMA_P20xx`) live in `SYSTEM_WIRE_CODES` in `tools/public-error-registry-lib.mjs`.
  2. English: harvested from the backend exception text, overridable in `tools/error-canonical-en.mjs` (`CANONICAL_EN_MESSAGES`). Use an override when the harvested text is a humanized code such as „Check in zone invalid.“
  3. Run `npm run error-codes:generate`. It rewrites `locales/{de,en}/errors.json`, `apps/core-api/src/common/errors/public-error-code-registry.generated.json` and `apps/core-web/src/api/generated/public-error-codes.ts`. Commit all of them.
  4. Run `npm run error-codes:check` and `npm run error-codes:check:test`. The quality check (`tools/error-de-quality.mjs`) rejects DE text that equals EN, looks English, or contains technical markers (code prefix, `/api/`, HTTP verbs, snake_case, Idempotency, rate limit, „VIN“, „Synthetisch…“, Serializer, Outbox, Payload, Header, Snapshot, Endpoint).
- `tools/error-message-de-translate.mjs` and `tools/sync-error-de-translations.mjs` are only a phrase-rule fallback. Their output is never shipped, because generation requires a hand-written catalog entry. Do not use them to produce DE copy.
- Some codes also have a frontend copy (for example `workshop:checkIn.errors.*`, `workshop:estimateSend.errors.*`, `sales:errors.codes.*`). When you change one, keep the text identical to the catalog entry.
- New code: an UPPER_SNAKE_CASE constant in the backend, a hand-written DE entry in the catalog, regenerate, and a test that maps the code.

## Formatting
- Dates, numbers, currency, percentages and relative times only via `@/lib/format`. Never `toLocaleString`, `new Intl.*` or hand-rolled `toFixed(2) + ' €'`. ESLint enforces this.
- Language and region are separate: UI language `de`/`en`, number and date format via `FORMAT_LOCALE` (`de-AT`) and time zone `Europe/Vienna`.

## Documents and legal texts
- PDFs and emails (core-api, for example `workshop/workshop-pdf.*`, `workshop/workshop-estimate-pdf.*`, `notifications/templates/customer-email-templates.ts`) render in the language of the document. The language is stored in the document snapshot. Do not re-render old documents in a new language.
- Legal texts (for example `workshop/workshop-estimate-legal-text.ts`, sales contract and warranty texts) exist **per language**. The **German version is authoritative**. The English text is a courtesy translation and must say so, for example: „This translation is for convenience only; the German version is legally binding.“ If an EN legal text is missing, fall back to DE. Never machine-translate a legal text, and never change its content without a ticket.

## Tests
- Vitest runs in **German** (`src/test/setup.ts`). Assert the real DE texts from the locale files, not the keys. For specs that switch language, call `registerGermanUiForTests()`.
- Prefer `getByRole` / `getByLabelText` with the DE label. Use `data-testid` only where there is no accessible name.
- Test an EN case only where the language switch itself is the feature.

## Checks (run before every push)
Requirements: **Node >= 22** (Vitest/jsdom fail on Node 20 with `webidl.util.markAsUncloneable is not a function`). Before core-api tests, run `npm exec --workspace=core-api -- prisma generate` (needed when `npm ci` skipped install scripts).
```bash
npm run i18n:check                          # DE/EN parity + used/unused keys (repo root)
npm run i18n:check -- --fail-unused         # stricter: unused keys become errors
npm run i18n:check:test                     # unit tests of the check itself
npm run error-codes:check                   # errors.json vs registry + DE quality (after error-codes:generate)
npm run error-codes:check:test              # also regenerates; fails if a code lacks a catalog entry
npm run lint --workspace=core-web           # i18next/no-literal-string (warnings) + Intl restriction (errors)
npm test --workspace=core-web               # Vitest (DE)
npm test --workspace=core-api -- src/common/errors   # when error codes changed
```
`i18n:check` exit codes: `0` passed, `1` validation errors, `2` usage or setup error. CI runs `i18n:check`, `i18n:check:test`, `error-codes:check` and `error-codes:check:test` in `.github/workflows/build.yaml`.

When you change a German term or message, also search for copies outside `locales/`:
```bash
rg -F "<alter Text>" apps --glob '!**/node_modules/**'
```
Tests, e2e helpers (`apps/core-web/e2e/helpers/de-shell.ts`, `apps/core-web/src/pages/login-page.test-copy.ts`) and some legacy modules still contain German literals. Update tests in the same PR. Report legacy source literals instead of silently leaving them.

## Migrating a domain (ratchet)
1. Move all strings of the domain folder into the namespace (DE and EN).
2. Add the folder to the strict ESLint config of the domain (or create `eslint-<domain>-i18n.config.js` based on `eslint-i18n-shared.config.js` and register it in `eslint.config.js`).
3. Update tests to the DE texts and run the checks above. Keep the PR small, one domain per PR.

## Never
- Literal user-facing strings in new code.
- Keys only in `de` or only in `en`.
- Customer or company names from real data in locale files, fixtures or examples. Use the term „pilot customer“ (in German „Pilotkunde“) only.
- Weakening `i18n:check`, the manifest or the ESLint ratchet to get green.
