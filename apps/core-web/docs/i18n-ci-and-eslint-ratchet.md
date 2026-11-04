# i18n CI checks and ESLint literal-string ratchet (AUT-578)

## Locale key CI (`npm run i18n:check`)

The root script `tools/i18n-check.mjs` validates repository locale files under `locales/{de,en}/`:

- **Parity:** every namespace file exists in both languages with the same leaf keys.
- **Missing / empty:** no missing keys and no blank string values.
- **Interpolation:** `{{param}}` sets must match between `de` and `en` for each key.
- **Plurals:** i18next plural suffix families (`_one`, `_other`, …) must match between languages.
- **Unused keys:** reported as warnings by default (see manifest below). Pass `--fail-unused` to block merges once static usage is complete.

Dynamic keys (enum maps, future error codes, backend-only bundles) are not inferred from runtime. Register them in `tools/i18n-check-manifest.json`:

- `treatNamespaceAsUsed`: entire namespaces counted as used (`enums`, `errors`, …).
- `usedKeyPrefixes`: keys starting with a prefix (e.g. `enums:status.`).
- `usedKeys`: explicit `namespace:dot.path` entries.

CI runs `npm run i18n:check` in the **Frontend Lint, Build and Unit Tests** job.

## ESLint `i18next/no-literal-string`

| Scope | Severity | Config |
| --- | --- | --- |
| Most `apps/core-web/src` (excludes tests, e2e, generated API types) | **warning** | `apps/core-web/eslint.config.js` |
| Migrated app shell | **error** | `apps/core-web/eslint-shell-i18n.config.js` → `shellI18nFiles` |
| Migrated enum / label maps | **error** | `apps/core-web/eslint-enums-i18n.config.js` → `enumsI18nFiles` |
| Migrated workshop & mechanic domain | **error** | `apps/core-web/eslint-workshop-i18n.config.js` → `workshopI18nFiles` |
| Migrated sales, vehicles, customers & vehicle-stock pages | **error** | `apps/core-web/eslint-sales-domain-i18n.config.js` → `salesDomainI18nFiles` |

Shared rule options live in `apps/core-web/eslint-i18n-shared.config.js`.

### Add a folder to the strict (error) list

1. Migrate user-visible strings in that folder to `t()` / `useTranslation` and add matching `locales/de` + `locales/en` entries in the same PR.
2. Append a glob to **`shellI18nFiles`** (UI) or **`enumsI18nFiles`** (finite enum/label maps) in the corresponding config file. Lists are **monotonic** — only grow, do not remove paths without an explicit revert PR.
3. Run `npm run lint --workspace=core-web` and fix any new **errors** in that folder (warnings elsewhere are expected until domains migrate).
4. If the folder introduces dynamic translation keys, extend `tools/i18n-check-manifest.json` so CI does not flag them as unused.

New product UI should use `t()` even outside strict folders; the global **warning** ratchet surfaces new literals in code review.

## ESLint design-token ratchet (AUT-659)

Same pattern as the i18n strict list, for colors and font sizes.

| Scope | Severity | Config |
| --- | --- | --- |
| Migrated folders (`src/pages/{workshop,vehicles,vehicle-stock}`, `src/components/{workshop,vehicles,vehicle-stock}`, `src/features/{workshop,vehicle-stock}`) | **error** | `apps/core-web/eslint-tokens-ratchet.config.js` → `tokenRatchetFiles` |

In those folders `no-restricted-syntax` fails on Tailwind palette colors (`text-slate-500`, `bg-amber-50`, `border-white`, …) and arbitrary font sizes (`text-[11px]`) in string literals and template strings. Tests are excluded. The block repeats the global `Intl.*` selectors because a later `no-restricted-syntax` entry replaces an earlier one.

To add a folder:

1. Replace palette classes with tokens using the mapping table in `.agents/skills/acp-ui-polish/SKILL.md` (section 2).
2. Append the glob to `tokenRatchetFiles`. The list is **monotonic**: only grow it.
3. Run `npm run lint --workspace=core-web` and the selector tests (`npx vitest run scripts/eslint-tokens-ratchet.test.ts`).

## Playwright locale smoke

`apps/core-web/e2e/i18n-en-login.spec.ts` sets the persisted UI language to English before load and asserts `document.documentElement.lang` plus login copy from `locales/en/common.json` (resource bundle smoke, not text selectors in DE tests).
