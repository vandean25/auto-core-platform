---
name: mintlify-docs
description: Use when writing, editing, or reviewing Mintlify documentation (MDX pages, docs.json, public docs site, user guides). Also trigger on Mintlify, docs.json, .mdx, "write docs", "user documentation", or when converting ADRs/runbooks into public docs.
---

# Mintlify Docs (ACP voice)

Public docs are a **workshop product**, not an engineering wiki. Write for the person standing at the counter.

**REQUIRED:** Read this skill before creating or editing any `*.mdx` or `docs.json`.

## Unique design (do not drift)

`docs.json` already encodes the look. Keep it:

- Theme `willow`, Lucide icons, Sora headings, IBM Plex Sans body
- Colors `#0F172A` / `#38BDF8`, slate backgrounds, grid decoration
- Breadcrumb eyebrows, dual GitHub code themes

Pages must *feel* like ACP UI: slate language, ledger metaphors, Lucide `icon` on Cards/Steps.

## Page recipe

Every page:

1. Frontmatter `title` + `description` (one sentence, user outcome)
2. Opening paragraph: what this screen is *for*, in bay-floor English
3. `CardGroup` or a 2-column table if the page has more than one job
4. `Steps` for any click-path (Settings gear → tab → row)
5. `Warning` / `Tip` / `Check` for one sharp constraint
6. `Accordion` for edge cases — never dump them in the intro
7. `Tabs` when the same UI has two audiences (user vs job vs delete)

Do **not** open with architecture history, Linear ids, or ADR numbers.

## Voice

| Do | Don't |
| --- | --- |
| "Open Settings → Audit Logs." | "Navigate to the audit module." |
| "The trail is append-only." | "Robust immutable compliance logging." |
| "Who changed this invoice?" | "Leverage observability for stakeholders." |
| Name the actual control | "Simply click around until you find it." |

Address **you**. Short sentences. Product nouns: tenant, bay, job, invoice, ledger.

## Audience split

- **Settings tab** — workshop users, accountants, support. No NestJS, no Prisma, no env vars.
- **Operations tab** — platform super-admins. HTTP is allowed. Still no ADR paste.
- Internal ADRs stay in `docs/internal/`. Mintlify may *summarize* behavior that shipped, never reproduce the decision record.

## Source of truth

Read the **shipped UI and API**, then write. If Settings has no control, do not invent a screenshot of one. If creates are unaudited, say so. Do not document hoped-for UI.

## Common mistakes

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
