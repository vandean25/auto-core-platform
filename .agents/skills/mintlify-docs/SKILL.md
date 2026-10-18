---
name: mintlify-docs
description: Use when writing, editing, or reviewing Mintlify documentation (MDX pages, docs.json, public docs site, user guides). Also trigger on Mintlify, docs.json, .mdx, "write docs", "user documentation", or when converting ADRs/runbooks into public docs.
---

# Mintlify Docs (ACP voice)

Public docs are a **workshop product**, not an engineering wiki. Write for the person standing at the counter.

**REQUIRED:** Read this skill before creating or editing any public `*.mdx` or `docs.json`.

## Languages (de-AT first)

The Mintlify site (`autocore-platform`) is **bilingual** via `navigation.languages` in `docs.json`:

| Locale | Code | Files | URLs |
| --- | --- | --- | --- |
| **Default** — Austrian German | `de-AT` | Repo root: `introduction.mdx`, `workflows/`, `settings/`, `operations/`, etc. | `/introduction`, `/workflows/sign-in`, … |
| English | `en` | Mirror tree under `en/` | `/en/introduction`, `/en/workflows/sign-in`, … |

**Write German first, then English.** New or updated pages need **both** trees with the **same page set** and matching navigation order (see `tools/docs-i18n-pages.mjs` for the shared page list). After editing navigation, run `node tools/patch-docs-json-i18n.mjs` only if you are intentionally regenerating language blocks from that shared list.

### Voice and terminology (German)

- **Sie-Form**, natural **Austrian** workshop/dealer German (Pickerl, Kostenvoranschlag, Gutschrift, Werkstatt, Jänner in dates, etc.).
- **UI labels** must match the app: read `locales/de/*.json` (and `locales/en/*.json` for English) — do not invent menu names.
- Internal links: **no** `/en/` prefix in German MDX; **always** `/en/…` in English MDX under `en/`.
- No Linear `AUT-` keys, no ADR numbers, no pilot customer real names (use „Pilotkunde“).

### Voice (English)

Same counter-floor tone as before: short sentences, name real controls, “you” not “the user”. Match `locales/en/*.json` for UI strings.

### Automations (docs-drift / docs-stale maintainers)

When an automation updates docs from product changes:

1. Update the **German** page at the root path.
2. Update the matching **`en/`** page in the same PR.
3. Keep `docs.json` navigation in sync (group labels are localized per language entry).
4. Run `mint validate` and `mintlify broken-links` from the repo root before pushing.

## Unique design (do not drift)

`docs.json` already encodes the look. Keep it:

- Theme `willow`, Lucide icons, Sora headings, IBM Plex Sans body
- Colors `#0F172A` / `#38BDF8`, slate backgrounds, grid decoration
- Breadcrumb eyebrows, dual GitHub code themes

Pages must *feel* like ACP UI: slate language, ledger metaphors, Lucide `icon` on Cards/Steps.

## Page recipe

Every page:

1. Frontmatter `title` + `description` (one sentence, user outcome)
2. Opening paragraph: what this screen is *for*, on the shop floor
3. `CardGroup` or a 2-column table if the page has more than one job
4. `Steps` for any click-path (Zahnrad → Tab → Zeile / Settings gear → tab → row)
5. `Warning` / `Tip` / `Check` for one sharp constraint
6. `Accordion` for edge cases — never dump them in the intro
7. `Tabs` when the same UI has two audiences (user vs job vs delete)

Do **not** open with architecture history, Linear ids, or ADR numbers.

## Audience split

- **Settings tab** — workshop users, accountants, support. No NestJS, no Prisma, no env vars.
- **Operations tab** — platform super-admins. HTTP is allowed. Still no ADR paste. **Translate operations pages to German** for AT operators; keep code paths and API examples accurate.
- Internal ADRs stay in `docs/internal/` (excluded via `.mintignore`). Mintlify may *summarize* behavior that shipped, never reproduce the decision record.

## Source of truth

Read the **shipped UI and API**, then write. If Settings has no control, do not invent a screenshot of one. If creates are unaudited, say so. Do not document hoped-for UI.

## Common mistakes

- English-only root MDX (breaks default locale)
- Mismatched page sets between `de-AT` and `en` navigation
- Copying runbooks/ADRs into MDX and calling it a user guide
- Mixing audit trail and server logs on one page without a comparison table
- Font Awesome icons (library is Lucide)
- New theme/colors "to make this page pop"
- Row-level icon tutorials that ignore "click the row"
- Promising delete/export of audit records

## Red flags — rewrite the page

- First heading is "Overview" or "Architecture"
- Words: robust, seamless, leverage, simply, comprehensive
- Code sample of Prisma `$extends` on a Settings page
- Linear `AUT-` keys in user-facing MDX
