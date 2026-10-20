---
title: "DE/EN internationalisation architecture"
date: "2026-10-16"
module: "Platform"
status: accepted
linear-project: "i18n DE/EN"
tags:
  - feature-spec
  - i18n
---

# DE/EN internationalisation architecture

## Scope and delivery

[AUT-575](https://linear.app/auto-core-platform/issue/AUT-575) specifies the architecture for [AUT-574](https://linear.app/auto-core-platform/issue/AUT-574). UI, customer documents/email and user-facing agent responses support German and English; numeric/date/currency formatting remains Austrian in either language. This PR changes documentation only. It neither implements translation infrastructure nor claims that all existing text is translated. Existing AUT-576–588 own implementation and the legal-text specification; do not create a competing backlog.

Checklist for this spec: inspect code and linked issues; settle locale/key/error/snapshot contracts; map unresolved content to existing owners; draft PR; GPT-6.1 Sol high review comments and fix until clean; successful GitHub CI; squash merge. No local tests/builds/runtime or dependency installation. Product implementation requires its own plan and TDD; merging this spec does not claim Dejan has reviewed German translations or approved legal wording.

## User stories

- A workshop user chooses DE or EN once and retains it across tenants, without changing Austrian dates/prices or another user's language.
- An advisor sends a document in the customer's language; later preference or translation changes cannot alter what was sent.
- Support correlates a translated error with its stable code/request id, without parsing English exception messages.
- Translators change repository JSON while domain migrations steadily prevent new hardcoded UI text.

## Verified baseline

Read against main `84a9786d4b9a6d20663ed8b2e969732954fb720a`, 16 October 2026. The epic's ~84 formatting calls, ~314 codes and ~18 snapshot fields are planning estimates from older main `5f4a7680`, not counts certified by this spec.

| Evidence | Current behaviour / consequence |
| --- | --- |
| `apps/core-web/package.json`, `apps/core-api/package.json` | No i18next/react-i18next dependencies. Web has Zod v4. AUT-577 introduces the frontend runtime; AUT-586 backend runtime. |
| `apps/core-web/index.html` | `lang="en"` is fixed. Bootstrap and language switch must update it. |
| `apps/core-web/src/components/global-search/global-search-format.ts`, `src/features/workshop/capacity/capacity-format.ts` | de-DE number formatting and en-GB hour/date formatting coexist. Central formatting must cover these helpers too. |
| `apps/core-api/src/invoices/invoice-pdf-date-format.helpers.ts` | Existing DACH-vs-ISO date branch. Replace only for new localised snapshots; legacy rendering must retain its historical branch. |
| `apps/core-api/prisma/schema.prisma`: User, Tenant, Customer; `auth/dto/auth-session.dto.ts` | No user/tenant/customer display-language fields or session locale contract. Existing mechanic voice `target_language_code` is a different preference. |
| `apps/core-api/src/auth/jwt-auth.guard.ts`, `auth/auth-session.service.ts`, `landing-demo-access/demo-role-restrictions.ts` | Tenant sessions require membership/non-null active tenant; platform-only authentication requires explicit route metadata. DEMO mutation allowlist blocks new PATCH routes by default. Self-language preferences need a separate response contract and a narrow DEMO allowance. |
| `apps/core-api/src/common/filters/global-exception.filter.ts`, `common/errors/client-safe-http-error-codes.ts` | Codes are dropped outside the client-safe allowlist, even for many 4xx errors; parameter forwarding currently allows selected string fields only. Additive safe code/parameter contracts are necessary, not message translation in the filter. |
| `apps/core-web/src/api/client.ts`, `src/api/workshop.ts`, `src/api/useInvoiceSettlement.ts` | Shared fetch adds authentication; error decoding/message use remains dispersed. AUT-585 migrates all consumers to one structured decoder. |
| `apps/core-api/src/invoices/invoice-snapshot*.ts`, `credit-notes/credit-note-snapshot.ts`, `workshop/workshop-estimate-snapshot.ts`, `vehicle-stock/kaufvertrag/kaufvertrag-snapshot.ts` | Versioned/frozen financial and estimate/contract snapshots already exist. Locale alone is insufficient: resource/legal/renderer versions or resolved text must also be frozen. |
| `apps/core-api/src/workshop/workshop-pdf.*`, `docs/internal/02-Feature-Specs/Workshop/tablet-check-in.md` | Ordinary order PDF is a mutable cache; completed check-in proposes frozen evidence. Both need language decisions at their respective freeze points, never on download. |
| `apps/core-api/src/audit/audit.service.ts`, `domain-event-store/domain-event.rows.ts` | Audit stores actor/before/after/diff; domain events store event type/version/payload. Preserve machine data and localise only presentation. |
| `apps/core-api/src/mcp/mcp-agent-instructions.spec.ts`, `mcp-settings-read.mapper.spec.ts` | MCP has instruction contracts; a settings test explicitly asserts no invented tenant locale today. Update output schemas/tests when introducing real persisted locale. No in-app general LLM chat executor was established by this inspection. |
| `apps/core-web/src/test/setup.ts` | Shared test setup exists; add real-resource DE i18n initialisation here. |

## Decisions and terminology

Language values are exactly `de | en`; region is a separate `format_locale: 'de-AT'`, time zone `Europe/Vienna`. Do not store `de-AT` as user language or derive region/tax country/currency from language. Customer address country, seller legal country and invoice tax rules remain separate domain facts. Unsupported input is rejected, not guessed from browser/IP/Accept-Language. Browser language never overrides an authenticated preference. Initial unauthenticated UI is DE; a deliberate pre-login choice may be stored locally.

Decision: use i18next/react-i18next for web with lazy domain namespaces, backend i18next with an explicit per-render language and shared repository JSON. Avoid a second message engine or translation SaaS. Alternative string-as-key gettext would couple English edits to identity; a hand-built dictionary would duplicate plural/fallback/type handling. Semantic keys with i18next fit the existing React/JSON stack. Installed versions and package lock are selected/committed in AUT-577/586, not inferred from documentation samples.

## Locale data model and resolution (AUT-576)

| Field | Storage and permission |
| --- | --- |
| `User.locale` | Nullable validated `de/en`; self profile setting only. Null means follow current tenant. User is global: resolve authenticated user id, never a supplied user/tenant id. |
| `Tenant.default_locale` | Non-null default `de`, validated `de/en`; OWNER/ADMIN of that active tenant may update. |
| `Customer.preferred_language` | Nullable `de/en`; existing customer-edit permission with tenant isolation. Null means follow tenant for the next document. |
| `Tenant.format_locale` | Non-null `de-AT` default and constraint, read-only in v1; stores region independently. No region-switch control or extra user/customer format override. |

Expand-only Prisma migration: nullable user/customer additions, tenant defaults/constraints; no rewrite of existing document JSON/hashes. No new entity/deletion endpoint. Existing tenant export/restore covers the added fields and verifies defaults; update generated restore/schema SQL if needed. Existing deletion policy remains applicable; user/account erasure clears preference with its owner. Tenant and customer queries always scope through tenant context; site-owned document access retains ADR-0022 rules, independent of locale.

Resolution functions, shared contract rather than a new service per domain:

- `resolveUserLanguage(user.locale, tenant.default_locale)`: user override → tenant default → `de`. On tenant switch re-resolve only if user locale is null. Missing/deleted old values read safely as null/default during mixed-version deployment; API writes allow only supported values.
- `resolveCustomerLanguage(customer.preferred_language, tenant.default_locale)`: customer → tenant → `de`. **Never user language** for customer documents/email. Non-customer transactional mail to a registered user uses that user's resolution. Anonymous landing demo access mail uses explicit validated form language → `de`.
- `resolveDocumentLanguage(snapshot)`: frozen `document_locale` for new schema; legacy missing field resolves `de` for new label lookups only, while its historical renderer and already frozen text remain unchanged. Rendering never consults live customer/user/tenant preferences.
- Local pre-login choice is subordinate to the authenticated session. During AUT-577 before AUT-576 lands it is temporary only; clear/reconcile it at login/session fetch and on logout/account switch. Persisted settings win thereafter. Changing language does not mutate tenant, site, business records or offline draft keys.

### API contracts

AUT-576 adds `GET /api/auth/me/preferences` and `PATCH /api/auth/me/preferences` `{locale:'de'|'en'|null}`, both returning a dedicated preference DTO `{locale, effectiveLocale, defaultLocale, formatLocale}`. These two routes explicitly use `@AllowPlatformAdmin()` plus `@MechanicAccessible()` and only a verified interactive User principal; tenant API-key principals cannot read/write a user's preferences. Resolve User by the authenticated request principal even when no TenantContext exists. Platform-only users without active membership get `defaultLocale:'de'`, `formatLocale:'de-AT'` and effective User.locale → de. Do not call the tenant-required `getSessionForAuthenticatedUser()` to build this response or make existing `activeTenant`/`activeRole` nullable. Tenant users get defaults only from their authorised active tenant. If their existing membership has expired or is inactive, retain normal access denial rather than treating them as a platform admin.

Extend the existing tenant-member GET `/api/auth/me` and switch-tenant response DTOs with the same four preference fields, preserving their non-null tenant/role shape and existing membership requirements. After self preference PATCH, refresh the session only for a tenant-member session; the platform shell uses the standalone preference GET/PATCH and existing platform authentication. Never trust a locale header for persistent preferences or let self-preference access grant tenant/site access.

DEMO users may persist their own locale: AUT-576 updates `isDemoMutationAllowed` in `landing-demo-access/demo-role-restrictions.ts` to additionally allow **only PATCH `/auth/me/preferences`** (and its normal `/api`-prefixed equivalent according to the existing path normalisation). DTO whitelist limits the body to locale, with no target user id or tenant setting. All other DEMO policy decisions remain unchanged, including its existing allowed demo-domain operations and blocked settings/financial operations; expired demo credentials remain rejected by authentication. This narrow addition is necessary for AUT-577's persisted switcher and AUT-588's EN demo; no additional domain-write permission is added.

Tenant settings use `PATCH /api/tenants/current/locale` `{default_locale:'de'|'en'}` and GET `/api/tenants/current/locale` returning `{default_locale,format_locale}` with active membership; read allowed to members, write OWNER/ADMIN. Customer create/update/read DTOs gain optional nullable `preferred_language`. Reuse existing customer routes, no duplicate profile records. Unknown/unsupported enum values produce stable validation error codes. Preference changes invalidate the session/settings/customer query keys and publish the existing domain invalidation where supported, without exposing other tenants' settings.

OpenAPI and generated web types must be regenerated/committed in route-owning PRs. This spec changes neither generated artifact. Follow existing query key factories; never put translated labels in cache keys or ids.

## Snapshot/document contract (AUT-576, AUT-586, AUT-588)

New customer-facing snapshots carry `document_locale`, `format_locale:'de-AT'`, `translation_bundle_version`, and `legal_text_version` (nullable if no legal block). At the document's existing freeze point, resolve language and freeze exact rendered label/legal strings or pin immutable versioned resource bytes available to the renderer. Version numbers alone without retrievable historical resources do not suffice. Snapshot schema/version validators, hash builders and adapters change together; never add fields to a historical immutable JSON just to satisfy a new type. Resolved text and its resource version are part of the content hash; PDF SHA-256 is calculated only after final bytes are rendered/stored. A text-identical re-render is required; byte identity is guaranteed by returning the archived artifact, not by pretending timestamps/renderer upgrades are deterministic.

| Snapshot/artifact family and source | Language freeze point and compatibility |
| --- | --- |
| Invoice.snapshot (`invoices/invoice-snapshot-v2.ts`, commit service/resolver/validators) | Existing finalisation/issuance commit. New localised schema/version; preserve both legacy v1/v2 read paths. |
| CreditNote.snapshot (`credit-notes/credit-note-snapshot.ts`, render adapter) | Existing issuance; derive language from original invoice, not changed customer preference. Reference/correction stays in the original document language. |
| WorkshopEstimateVersion.snapshot (`workshop/workshop-estimate-snapshot.ts`) | Send of each version; new draft revision may choose current customer language, sent versions never change. Approval page/confirmation mail use sent version language. |
| VehicleSale.kaufvertrag_snapshot (`vehicle-stock/kaufvertrag/kaufvertrag-snapshot.ts`) | Existing contract snapshot generation/finalisation. New legal/versioned text must be frozen before customer delivery; historical contracts immutable. |
| Ordinary WorkshopOrder PDF (`workshop/workshop-pdf.*`) | First generation creates a frozen localised render input for that artifact version; later content regeneration makes a new artifact version, invalidates cache and freezes a new input. Download never re-resolves language. No claim that an ordinary mutable order PDF is a signed archive. |
| Completed WorkshopCheckIn evidence (AUT-385 spec) | Completion freezes check-in acknowledgement and whole render input in customer language; changing UI language while signing invalidates no business facts, but a changed acknowledgement language/text requires a new review/signature before completion. |
| Loaner documents (AUT-586 scope; `loaner-vehicles/*`) | No loaner PDF snapshot established in current source inventory. If renderer is added, it must create versioned handover/return render inputs at those actions before delivery; do not invent a deployed snapshot column. |
| NotificationOutbox/customer mail (`notifications/templates/customer-email-templates.ts`) | Freeze rendered subject/body and locale/template version on enqueue in the mutation transaction; retry sends those bytes, not today's resources/customer setting. Document-related confirmation uses that document's frozen language. |
| Landing demo access (`landing-demo-access/*`) | Freeze selected language/template at grant-mail enqueue; not resolved from the browser on provider retry. |

Not every name containing “snapshot” is a document. `AccountingExport.profile_snapshot`, invoice/credit-item accounting snapshots, valuation snapshots, registration `match_snapshot`, numeric vehicle sale cost/margin/days snapshots, labor rate snapshots and warranty line facts are machine/business evidence: keep codes/numbers unchanged, localise only their UI labels. `WorkshopInspectionItem.label_snapshot` preserves historical tenant-provided wording; built-in templates gain stable label keys plus original text, existing filled inspections are never bulk-translated. This classification replaces the approximate “18 fields” as the implementation rule. AUT-576 records a checked inventory of all snapshot producers/consumers before schema work, including any added since this baseline; any new customer-visible snapshot must follow the same contract, not just the table above.

PDF language switch is explicit on draft only; issuing/sending/freezing uses customer default unless the advisor deliberately selects DE/EN. If supporting this per-document override, persist it on the draft, validate permissions and display it before delivery; no silent follow-user option. Currency remains the actual document currency, never derived from language; numeric formatting uses de-AT.

## Resources, keys and translation workflow

Canonical files: `locales/{de,en}/{namespace}.json` at repository root, imported/bundled through the web runtime and copied into backend build artifacts for workers/email/PDF. No runtime CDN, translation editor or customer-uploaded JSON. AUT-577 initialises frontend, AUT-586 packages backend resources and verifies a built worker can load them. Shared language/format type definitions live beside resources or in a small shared module; do not duplicate divergent type unions.

Namespaces: `common`, `nav`, `glossary`, `enums`, `errors`, `workshop`, `sales`, `finance`, `inventory`, `vehicles`, `hr`, `agent`, `settings`, `platform`, `pdf`, `email`. Purchase/vendor strings use `inventory.purchase` / `inventory.vendors` within inventory; reports use owning domain or platform. Example calls: `t('workshop:checkIn.actions.complete')`, `t('common:actions.save')`, `t('enums:workshopOrder.status.INTAKE')`. Same word may have separate keys when context differs. Do not use English sentences, IDs, column names guessed at runtime, concatenated translated fragments or template literals as translation keys. Enumerations/error registries use explicit finite maps checked by CI.

Use whole sentences with named typed parameters; i18next count plural forms for 0/1/2 and higher, not English suffix concatenation. Both languages must have equal leaf keys, parameter sets and compatible plural families; reject empty values and raw keys. Developer test mode fails on missing keys; production falls back to DE, then a generic translated message and records a key-only diagnostic. Never show a raw key to the customer. Do not use English `defaultValue` to hide missing DE translations.

Frontend initialises supported languages de/en, fallback de; preload common/nav/errors/glossary/enums and lazy-load each screen's namespaces before showing the screen. Keep the old complete language visible until a switch's resources load; commit lang/validation/render together. React escapes interpolation; translations contain plain text, with narrowly controlled React component slots for links, never unsafe HTML. Backend HTML/email interpolation must escape untrusted values explicitly; React's escaping does not apply there. No module-global backend `changeLanguage()` per request: use a request/render-bound translator so simultaneous DE/EN jobs cannot leak language.

Workflow: preserve existing EN wording as starting text where correct, author idiomatic Austrian DE, use machine translation only as an editable proposal, and submit both JSON files in the same PR for Dejan's review. Code review/CI validate structure; Dejan reviews user-visible wording through PR review. Do not imply his sign-off from this spec merge. Legal texts follow AUT-587 and are never machine-translated automatically. Resource changes for new UI may ship through normal PRs; frozen document bundles remain versioned and retained with their consumers.

Glossary starter contract:

| Concept | DE (Austria) | EN |
| --- | --- | --- |
| Periodic inspection §57a | Pickerl (§57a) | Periodic inspection (§57a) |
| Estimate | Kostenvoranschlag (KVA) | Cost estimate |
| Service reception | Fahrzeugannahme | Vehicle check-in |
| Workshop order | Werkstattauftrag | Workshop order |
| Credit note | Gutschrift | Credit note |
| Statutory warranty | Gewährleistung | Statutory warranty |
| Commercial guarantee | Garantie | Commercial guarantee |
| NoVA | Normverbrauchsabgabe (NoVA) | NoVA (Austrian vehicle registration tax) |

Names/descriptions/free text authored by a tenant/customer remain original data; switching language never translates or overwrites them. Built-in demo/template data use stable keys with DE/EN display resources; historical snapshots keep original labels. A demo in EN can legitimately contain a person's name or user-entered DE note; the no-DE-residue criterion applies to product-owned UI/built-in labels, not arbitrary customer text.

## Formatting and validation (AUT-577)

`apps/core-web/src/lib/format.ts` is the single web entry point for date/date-time/number/currency/duration/relative rendering; backend equivalent `apps/core-api/src/common/i18n/format.ts` follows the same contract and fixtures. Use Intl numeric/date options with `de-AT`; instants explicitly `Europe/Vienna`, calendar-only ISO dates parsed as dates without UTC midnight shifts. Null/missing is a translated placeholder; invalid values are rejected by validation or shown as unknown, never a bogus date/NaN. Parse API values as machine ISO/decimal data, not formatted strings. Formatters do not round stored financial values or change tax/currency; display precision follows the domain's existing rules.

Examples in DE **and EN**: 2026-10-16 displays `16.10.2026`; numeric 1234.5 displays `1.234,5`; EUR amount uses Austrian separators and currency placement. Relative wording uses translated templates (“vor {{count}} Minuten” / “{{count}} minutes ago”) around de-AT formatted numbers; never use browser-locale prose or force German relative words into English UI. Sort/collation remains de-AT for display strings; do not change server paging/order/id comparisons in this migration.

AUT-577 replaces all direct production frontend Intl/toLocale formatting calls (including global-search/capacity) and guards that only lib/format uses them. Explicit exceptions: tests proving formatter behaviour and non-display `localeCompare` only when part of an existing machine sort. Backend domain formatters move as their document families migrate; old renderer formatting remains in its compatibility adapter. No broad change to machine JSON/CSV/accounting export date/decimal formats.

Zod v4 gets a de/en locale map from supported built-in locales; custom errors use semantic resource keys, resolved at parse/display time rather than module-load strings. Revalidate visible errors on language switch without resetting values, dirty state or submission. Browser-side locale configuration is acceptable for the single active UI language; backend validators must remain request-scoped if using Zod. class-validator errors are machine validation rules/fields from the API, translated by the client as below. Update `document.documentElement.lang` to de/en at bootstrap and each committed language switch; initial static HTML is de.

## Error code contract and mapping (AUT-585)

The API remains language-neutral. Preserve existing `statusCode`, `message`, safe `code`, diagnostic IDs and legacy allowed detail fields for backward compatibility. Add a validated `params` object and field violations where needed; existing message stays diagnostic/legacy and is never the source of user-visible text after migration. No translated backend exceptions or free-text parsing. Unexpected 5xx retain sanitisation and generic safe code; never expose Prisma internals, provider payloads, SQL, stack or secrets to translators/clients.

Create one explicit code registry under `apps/core-api/src/common/errors/` containing wire code, public/private classification, error translation key and typed allowlisted params. Web consumes a generated finite map/type artifact (not a hand-maintained parallel list). All public codes map mechanically to **`errors:codes.<EXACT_WIRE_CODE>`**; this is a semantic stable code key, not English source text. Do not rename wire codes to translate them. Examples:

| Wire code | Resource key | Safe parameters / behaviour |
| --- | --- | --- |
| `ACTIVE_SITE_REQUIRED` | `errors:codes.ACTIVE_SITE_REQUIRED` | none; “Standort auswählen.” / “Select a site.” |
| `VEHICLE_HAS_ACTIVE_ORDER` | `errors:codes.VEHICLE_HAS_ACTIVE_ORDER` | preserve `orderId` for authorised link; interpolate `orderNumber` only, never invent missing data. |
| `ESTIMATE_CUSTOMER_EMAIL_MISSING` | `errors:codes.ESTIMATE_CUSTOMER_EMAIL_MISSING` | none; request customer email, not provider details. |
| `FISCAL_PERIOD_LOCKED` | `errors:codes.FISCAL_PERIOD_LOCKED` | none until registry declares a verified safe date parameter. |
| unknown/missing code or malformed body | `errors:generic.unexpected` | generic translated text, safe request/event id separately as support reference. |

AUT-585 inventories **all** exception/application/MCP/public-error code definitions and producers in the then-current tree, compares them to the current allowlist and consumers, and commits an exhaustive generated code→key coverage artifact with both DE/EN resources. The epic's ~314 is not a limit or hardcoded assertion. Private internal/provider codes explicitly map to a generic public code and are not blindly allowlisted to satisfy parity. Existing public codes currently stripped by the filter get reviewed and safely preserved; exceptions without codes gain registered semantic codes. CI rejects duplicate codes with conflicting meanings, public codes with no two-language key, missing params, orphan mappings and new uncoded user-facing exceptions in migrated paths.

Normalise non-2xx responses once in the web API layer into `{status,code,params,violations,requestId,eventId}`; all hooks/toasts/forms use this decoder and a translation helper. Authentication/network/non-JSON failures get explicit generic keys. Form violations carry stable field path + validation rule key + safe numeric bounds, not rejected secret/input values. Keep legacy `message` in transport for old callers but never read it in migrated or final UI error handling. Existing top-level detail allowlists are retained; a new params object must have its own typed per-code whitelist, not bypass the safe filter by forwarding arbitrary objects. Client validates types and ignores undeclared params. Do not interpolate IDs as HTML.

## Audit, events, Agent and MCP decisions

1. **Audit/domain events:** persist canonical codes, schema version, ids, numbers, timestamps and original user text. Technical log prose stays English for operations, not translated at write time. UI summaries use `agent`/owning domain keys from event type plus typed payload; unknown historical events show a translated generic event label with preserved raw details available under existing permissions. Never rewrite historical audit rows or change event/idempotency semantics to localise them.
2. **User-facing agent:** response language = authenticated user → tenant → de, frozen in a turn/request context; tenant/site access and HUMAN_ONLY/proposal gates unchanged. Tool names/descriptions, parameter names, enums and structured output stay English/machine-stable. MCP returns effective language metadata through authenticated session/settings context and server instructions; locale is advisory for prose, never an authorisation fact. External MCP hosts control final natural-language rendering, so tests can verify provided locale/instructions and representative host output, not guarantee every third-party model obeys. No fake internal chat integration.
3. **Customer-directed agent output:** recipient/customer or linked document language wins, regardless of advisor/agent operator language. Agent-generated customer prose must flow through existing review/send domain workflows; tool calls cannot silently send messages or change customer language. Typed business data is not auto-translated. Customer estimate approval pages use frozen estimate language without leaking tenant/user preferences. Voice transcription/translation language settings remain independent and are not overwritten by UI locale.

## Legal text boundary and open points

Product decision: DE is the authoritative wording; EN is an additional presentation translation. Provisional English notice: **“English translation for information. In case of discrepancies, the German version prevails.”** Product copy does not establish legal enforceability. AUT-587 owns the final DE/EN notice, mandatory tax/warranty/KVA/AGB/privacy blocks, jurisdiction/language versioning and Dejan's content approval. AUT-586 depends on that spec; do not machine-translate legal blocks or present an unreviewed EN waiver as binding. Preserve existing legal-release flags/guards; this architecture adds no waiver or legal approval.

For new bilingual customer documents, snapshot and render the exact German legal block alongside the reviewed English legal block/notice in an EN document. This supplies the referenced German wording rather than a meaningless “DE prevails” notice pointing to an unavailable text. If reviewed EN legal content is missing, render DE legal block plus a translated availability notice; do not silently claim the whole document is an approved EN legal version. UI warns advisor before delivery. Legal text resources have immutable versioned bytes and language/country metadata distinct from format_locale. Historical documents retain their exact legal text.

| Previously open item | Decision / follow-up owner |
| --- | --- |
| Audit and domain event language | Machine-neutral stored payload; translated viewer, English technical logs. AUT-584/585. |
| Agent/MCP toward customer | User language for user, recipient/document language for customer, schema/tool descriptions stable EN. AUT-585; document/mail paths AUT-586/588. |
| EN legal force and notice | DE authoritative product policy; draft notice above. AUT-587 finalises exact texts/approval and legal caveats before dependent PDFs. No new follow-up needed. |
| Approximate snapshot/error counts | Producer/consumer inventory is an AUT-576/585 implementation prerequisite; this spec defines inclusion/classification rules. |
| Translation review | Dejan reviews DE/EN repository resource PRs; legal block review tracked in AUT-587. No sign-off asserted here. |

## Migration ratchet and existing ticket sequence

1. AUT-576 data/session and snapshot contracts; AUT-577 frontend runtime/format/Zod/dynamic lang and test foundation. Data/schema deploy before enabling writes; coexistence with old clients is additive.
2. AUT-578 adds CI key/param/plural parity and unused-key report, global literal warning, strict error overrides for an explicit monotonically growing migrated-folder list. Dynamic enum/error maps and backend-only pdf/email resources count as usage via manifest; do not delete those as falsely unused. Missing/parity errors always block, unused keys initially report until statically proven safe. Translation resources are reviewed as product text, not arbitrary lint suppressions.
3. AUT-579 shell/navigation/login/glossary (includes sidebar decomposition only as scoped there), AUT-580 enum maps, then AUT-581 workshop/mechanic, AUT-582 sales/vehicle stock, AUT-583 finance/purchase/vendors, AUT-584 inventory/tyres/HR/reports/settings/platform/agent supervision. Migrate strings plus existing tests in the same domain PR, not English test fixtures masking DE gaps.
4. AUT-585 error registry/decoder and user/customer agent context can build after foundation; final coverage reconciles every migrated domain and newly merged code. AUT-587 legal specification after this architecture; AUT-586 PDF language after data + legal specification; AUT-588 frozen mail templates and demo/seed labels after data/PDF contracts.

Before each domain migration, inventory open PRs/branches touching it; merge ready ones or explicitly freeze them with a tracked owner in the migration PR. Do not silently abandon or force-merge another task. Rebasing a resumed branch must adopt t() and the strict folder rules. From AUT-577 merge onward, every new feature uses t() even in folders not yet strict; AUT-578 enforces new-file/diff coverage so the warning-only legacy baseline is not a loophole. Exceptions only for machine constants, API fields, testids, technical logs, CSS/classes, user text and audited historical renderers; each broad lint exception needs a concrete rationale, never a whole-domain disable.

AUT-558 offline drafts store canonical codes/numbers/ISO dates/zone IDs and original free text; no translated display labels or resolved UI strings. Locale switch re-renders existing input without resetting draft, queue IDs/revisions or business values. Signed acknowledgement/document content retains its frozen language. Failed local saves keep dirty state; locale changes never trigger replay under a different tenant/site.

No implementation plan/code in this ticket; each owning ticket carries a reviewed scoped checklist and meaningful Red→Green→Refactor tests. No duplicate AUT-483 work: AUT-577 absorbs its lang/glossary foundation scope. Shared bundles/registry changes are small independent PRs before broad domain rewrites.

## UX and tests required in implementation

Language selector in profile menu uses “Deutsch” / “English”, keyboard labels and immediate pending/error feedback; failed persistence restores the last confirmed selection. Admin tenant default in Settings; customer preference in existing customer form. Existing 750ms form autosave and layout standards apply; actions top-right, context left, shared badges and query factories. Switching never resets unsaved values, focus, route or open dialogs. Long DE text must wrap on tablet; no flag icons as language labels. All new text including placeholders/tooltips/aria labels/toasts/error/fallback strings is translated.

- Shared tests fixed on `de` with **real DE resources**, fresh isolated i18next instance/reset per test; no identity `t(key)` mock. Use accessible roles/testids where text is not the assertion. Explicit EN switch tests override language only for the case and reset afterwards.
- Resolution/API E2E: user override/null, tenant switch, customer preference/null, unsupported values, TECH self-setting, forbidden tenant/customer writes and cross-tenant/site denial; missing old fields. Platform-only GET/PATCH self preferences succeeds without TenantContext/membership, User.locale null resolves de, tenant-required session response remains unchanged/non-null, tenant API keys cannot use preferences, and unauthenticated/inactive non-platform users remain denied.
- DEMO guard/API tests: active DEMO can GET/PATCH only its own language (de/en/null), switch/reload persists EN; exact method/path addition does not admit arbitrary auth routes, target user/tenant ids, tenant-default mutations, or expired demo sessions. Existing allowed demo-domain operations and blocked operations retain their current results; self-locale setting grants no new domain capability.
- CI key checks: missing/empty DE or EN, interpolation/plural mismatch, dynamic enum/error manifests and lazy namespace load failure; strict-folder hardcoded literal and new-feature ratchet failures. Development missing key fails; production fallback never leaks key or backend text.
- UI/Playwright: DE default, EN switch, reload/login/session sync, switching with unsaved complex form/validation errors/offline queue, HTML lang and axe, lazy resource failure/race, long DE tablet strings.
- Format fixtures in both languages: Austrian numbers/money/dates, date-only versus timestamp, Vienna daylight-saving transition, invalid/null values; no accidental change to exports or arithmetic.
- Error tests: safe registry codes through production filter, unknown/private 5xx sanitised, non-JSON/network/401, typed field errors, rejected unsafe params and no message-text parsing. Every registered public code has DE/EN resource coverage.
- Snapshot/PDF/mail tests: new DE/EN per family, legacy snapshots unchanged, changed live locale/resources/branding after send cannot change archived text/hash, duplicate job sends frozen mail, credit note inherits original language, customer vs user conflict, missing EN legal block explicit DE fallback and notice, archive PDF hash only after render. Packaging smoke runs against built backend resources in CI.
- Agent/MCP contract tests: user effective language context, customer/document language override, English tool description and invariant schemas/codes; original free text preserved, no tenant/site/proposal bypass. Record external-host compliance as an integration limitation.
- Release evidence belongs to owning PRs: backend tenant guard/lint/type/build/unit/fresh unseeded serial E2E and frontend lint/build/unit/Playwright/contract checks. The Fallow code-health gate applies; no loosened gate config to disguise migration complexity. Spec PR uses GitHub CI only and makes no implementation/device/legal-success claim.

## References

- [AUT-575](https://linear.app/auto-core-platform/issue/AUT-575), [epic AUT-574](https://linear.app/auto-core-platform/issue/AUT-574), existing children AUT-576–588; inspected using Linear CLI.
- [i18next configuration](https://www.i18next.com/overview/configuration-options), [fallback](https://www.i18next.com/principles/fallback), [interpolation](https://www.i18next.com/translation-function/interpolation); [react-i18next setup](https://react.i18next.com/latest); [Zod v4 error localisation](https://zod.dev/error-customization). These describe library capabilities, not proof the unimplemented architecture runs here.
- [Tablet check-in](../Workshop/tablet-check-in.md), [customer communication/approvals](../Workshop/customer-communication-and-approvals.md), ADR-0007 async PDF, ADR-0024 branding, ADR-0025 customer evidence and existing document snapshots; their immutability/security rules remain binding.
