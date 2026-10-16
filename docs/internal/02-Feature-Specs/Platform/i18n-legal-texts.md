---
title: "Versioned DE/EN legal text catalogue"
date: "2026-10-16"
module: "Platform"
status: approved
linear-project: "i18n DE/EN"
tags:
  - feature-spec
  - i18n
  - legal-text
---

# Versioned DE/EN legal text catalogue

## Scope and delivery boundary

[AUT-587](https://linear.app/auto-core-platform/issue/AUT-587) defines the product-owned legal text catalogue for invoices/credits, vehicle purchase contracts, workshop estimates and transactional email. It implements the content contract of [AUT-575](i18n-de-en.md), merged in PR #821. German is the authoritative product wording; English is a supplementary translation. Numeric/date formatting remains de-AT; governing jurisdiction is determined independently from the seller/document facts.

This is a **documentation-only specification**: complete DE catalogue and EN drafts, applicability rules, version/fallback/approval contract and implementation acceptance cases. It does not change tax/warranty rules, schema, renderers, issued documents, customer send flags or notification behaviour. Proposed texts below are engineering/editorial drafts, not a claim of lawyer approval or Dejan's content approval. Spec merge completes AUT-587's acceptance criterion and supplies AUT-586/588's contract; activating newly approved customer wording still follows the explicit content approval and existing domain release guards below.

Delivery checklist: inspect Linear/spec/source; verify legal references; draft catalogue and guard matrix; draft PR; GPT-6.1 Sol high review comments and fix until clean; GitHub CI; squash merge. No local builds/tests/runtime checks or dependency installation. Never identify the pilot customer.

## Verified baseline and gaps

Main inspected: `de61d6c7e4de041144eb34681cecc07d67d669e9`, 16 October 2026.

| Source | Existing contract / gap |
| --- | --- |
| `apps/core-api/src/workshop/workshop-estimate-legal-text.ts` | `kv-legal-de-v1`, fixed non-binding/free/privacy paragraphs, validity text and hash. Source explicitly says wording is draft and customer send is flag-gated. Preserve historical block bytes/version/hash. |
| `apps/core-api/src/vehicle-stock/kaufvertrag/kaufvertrag-pdf.layout.ts` | Hardcoded DE consumer standard/shortened and B2B warranty, presumption note and separate voluntary Garantie. Existing end-date copy is stronger than the tracker supports; new localised wording must say base period and retain statutory extensions. |
| `apps/core-api/src/vehicle-stock/gewaehrleistung/gewaehrleistung-rule-sets.ts` | Rule versions before/from 1 October 2026; v2 excludes qualified-repair extension from its computed base date. Text selection must follow frozen rule/contract date, not today's date. |
| `apps/core-api/src/invoices/margin-scheme-legal-notes.ts` | Separate AT §24 and DE §25a notes; jurisdiction is seller country, not language. |
| `apps/core-api/prisma/schema.prisma`, `InvoiceTaxMode`; `docs/internal/02-Feature-Specs/Finance/legal-invoicing-and-credit-notes.md` | Only STANDARD and MARGIN_SCHEME modes; initial domestic AT/DE/EUR scope excludes reverse-charge, intra-community and small-business tax profiles. Catalogue entries do not enable these missing tax workflows. Never infer them from zero VAT or an EN customer. |
| `apps/core-api/src/notifications/templates/customer-email-templates.ts` | DE estimate-sent, approval-confirmed and order-ready templates; copy described as draft, no complete controller-specific privacy notice/footer in this shared template. |
| `apps/core-api/src/site/legal-entity-seller.validation.ts`, `site/dto/site.dto.ts` | Seller/payment-term fields exist. No complete versioned tenant AGB/privacy policy configuration established by inspection. Do not mislabel ACP's own privacy page as the workshop controller's policy. |
| `docs/internal/02-Feature-Specs/Vehicle/kaufvertrag-pdf-aut-442.md`, `gewaehrleistung-tracking-aut-408.md` | AT-only purchase-contract wording and immutable archive, statute-derived base dates; no blanket B2B exclusion or automatic shortening via template. |
| `docs/internal/02-Feature-Specs/Platform/i18n-de-en.md` | Freeze language/resources/legal text at issue/send; EN document includes exact DE legal block; fallback DE is visible; no automatic machine translation of legal text. |

## Applicability and precedence

1. Resolve customer/document language per AUT-575, never operator UI language. `country` below means legal jurisdiction/seller profile (`AT`, existing DE margin `DE`), not `document_locale` or `format_locale`. Unsupported jurisdiction/content combination blocks new localised generation with a stable code; never reuse AT warranty on a DE seller.
2. Authoritative domain facts select blocks: frozen tax treatment, consumer status, qualified individually negotiated shortening, contract date/rule version, voluntary guarantee facts, estimate validity/free status. UI language selects a language variant **after** applicability. Text is not a rule engine and cannot grant an exemption, shorten warranty, incorporate AGB or obtain consent.
3. Include product notices only where relevant; “mandatory” here means a product-enforced block for its applicability, not a claim that every sentence is a legally prescribed formula. Statutory invoice identity/tax/amount fields remain required separately and are not replaced by a footer.
4. No generic disclaimer can override mandatory consumer rights, lawful language requirements or an individually agreed term. “DE prevails” is a product presentation policy, not proof a court will enforce a language clause. No jurisdiction choice or liability waiver is added.

## Complete catalogue: German wording and English drafts

All IDs are stable semantic legal block ids. Unless noted, country AT; DE text and EN text start at editorial version `v1-draft` for this specification. Runtime published version IDs are allocated only in implementation, separately from existing `kv-legal-de-v1`. Text between quotation marks is proposed customer copy, not a statutory quotation. Placeholders are a closed typed set; they are resolved, validated and frozen before publication. Each DE/EN pair needs its own approval record.

### A. Tax notes

| ID / applicability | German draft | English draft |
| --- | --- | --- |
| `tax.reverseCharge` — AT, only a supported/validated reverse-charge transaction | Steuerschuldnerschaft des Leistungsempfängers (Reverse Charge). | VAT payable by the recipient (reverse charge). |
| `tax.smallBusinessExempt` — AT, validated domestic exemption under §6(1)(27), no option to charge VAT | Umsatzsteuerbefreit gemäß § 6 Abs. 1 Z 27 UStG 1994 (Kleinunternehmerregelung). | Exempt from VAT under section 6(1)(27) of the Austrian VAT Act 1994 (small business exemption). |
| `tax.intraCommunitySupply` — AT, validated exempt intra-community goods supply, not a service | Steuerfreie innergemeinschaftliche Lieferung. | VAT-exempt intra-Community supply of goods. |
| `tax.marginSchemeUsedGoods` — AT seller, existing MARGIN_SCHEME | Differenzbesteuerung gemäß § 24 UStG 1994 (Gebrauchtgegenstände). | Margin scheme for second-hand goods under section 24 of the Austrian VAT Act 1994. |
| `tax.marginSchemeUsedGoods` — DE seller, existing MARGIN_SCHEME; separate country variant | Gebrauchtgegenstände/Sonderregelung – Differenzbesteuerung gemäß § 25a UStG. | Margin scheme for second-hand goods under section 25a of the German VAT Act. |

Reverse charge requires its domain validation, recipient/supplier VAT identification and no separate VAT disclosure; a printed note does not make the transaction valid. Intra-community goods supply is not reverse charge for a service. Zero-rate STANDARD alone selects **none** of these exceptions. Incompatible/missing tax facts block issuance rather than concatenate contradictory exemptions. Mixed-treatment documents are unsupported until the tax-domain contract explicitly supports line-level applicability. Ordinary domestic STANDARD has no invented exemption note.

The first three entries are **catalogue-ready drafts, runtime ineligible** while the tax profiles are unsupported. AUT-586 must preserve existing tax guards and document this deferred capability; implementation of new tax modes needs a separate finance-scoped approved change, not a locale change. Existing AT/DE margin selection remains country-specific; DE tax wording still needs its own approval before a new bilingual version is activated. Historical margin notes/rendering remain on their existing path.

### B. Kaufvertrag: statutory warranty and voluntary guarantee

AT used-vehicle contracts only; the existing eligibility/calculation rules remain authoritative. The paragraph set never states that all rights expire on a computed date.

| ID / selection | German draft | English draft |
| --- | --- | --- |
| `sale.warranty.standard` — consumer, no qualifying shortening | Es gilt die gesetzliche Gewährleistung. Die Basisfrist beträgt zwei Jahre ab Übergabe. | Statutory warranty rights apply. The base period is two years from handover. |
| `sale.warranty.shortened` — consumer, shortening individually negotiated and validated by existing rules | Die Gewährleistungsfrist wurde im Einzelnen auf ein Jahr ab Übergabe verkürzt. Seit der Erstzulassung ist mehr als ein Jahr verstrichen. | The warranty period was individually negotiated down to one year from handover. More than one year has elapsed since first registration. |
| `sale.warranty.baseDate` — consumer, computed date available; always follows standard/shortened | Berechnete Basisfrist bis {{baseEndsOn}}. Gesetzliche Verlängerungen bleiben unberührt. | Calculated base period until {{baseEndsOn}}. Statutory extensions remain unaffected. |
| `sale.warranty.b2b` — non-consumer | Unternehmergeschäft: Für die Gewährleistung gelten die vertraglichen Vereinbarungen und die anwendbaren gesetzlichen Bestimmungen. | Business transaction: warranty rights are governed by the contractual terms and applicable law. |
| `sale.warranty.presumption` — consumer, existing one-year presumption facts | Zeigt sich ein Mangel innerhalb eines Jahres ab Übergabe, wird grundsätzlich vermutet, dass er bereits bei Übergabe vorlag. Die gesetzlichen Ausnahmen bleiben unberührt. | A defect becoming apparent within one year of handover is generally presumed to have existed at handover. Statutory exceptions remain unaffected. |
| `sale.warranty.repairExtension` — **consumer only** (`CONSUMER_BASE` or `CONSUMER_SHORTENED`) AND rule `at-used-vehicle-vgg-2026-10-v2` AND contract from 1 October 2026 | Bei einer Verbesserung nach § 12 Abs. 2 VGG verlängert sich die Gewährleistungsfrist einmal um ein Jahr. Diese Verlängerung ist im angezeigten Basisdatum nicht eingerechnet. | A repair under section 12(2) VGG extends the warranty period once by one year. This extension is not included in the displayed base date. |
| `sale.guarantee.separation` — voluntary guarantee configured | Eine freiwillige Garantie besteht zusätzlich zur gesetzlichen Gewährleistung und schränkt diese nicht ein. Dauer: {{guaranteeMonths}} Monate ab Übergabe. Es gelten die gesondert dokumentierten Garantiebedingungen. | A voluntary commercial guarantee is additional to statutory warranty rights and does not restrict them. Duration: {{guaranteeMonths}} months from handover. The separately documented guarantee terms apply. |

`baseEndsOn` is a de-AT formatted date from the frozen tracker; no date when missing or B2B. `guaranteeMonths` is the existing validated positive duration. Free-text guarantee terms remain exact original tenant data; never machine-translate or imply that a short separation paragraph is a complete guarantee declaration. The guarantee provider/terms required by the applicable guarantee workflow must exist; new bilingual generation must not silently claim complete legal content if that workflow lacks required facts. AUT-586 records any missing guarantee-declaration fields as a scoped prerequisite and keeps the existing omission/guards.

A template checkbox is not evidence that shortening was individually negotiated. Use the existing recorded negotiation fact, consumer flag and vehicle-age guards; no pre-ticked consent or automatic one-year term. New legal text references the frozen rule selected by contract conclusion, with handover used for base-date computation. The v2 extension paragraph is never applied retrospectively to old rule versions; the arithmetic engine remains unchanged. Do not patch historical Kaufvertrag PDFs whose wording differs; new wording means new document/template version.

`B2B_PER_CONTRACT` always excludes all consumer base-date, presumption and repair-extension blocks, even when its stored rule version is v2. The source's rule identifier alone does not establish VGG consumer applicability.

### C. Kostenvoranschlag (KVA)

These drafts carry forward existing semantics and clarify the overrun limitation. Mandatory non-binding declaration is prominent in PDF and immediately above the customer decision controls, never removable by branding, tenant text or translation.

| ID / selection | German draft | English draft |
| --- | --- | --- |
| `estimate.nonBinding` — every non-binding estimate | Dieser Kostenvoranschlag ist unverbindlich. Er beruht auf der Einschätzung der Arbeiten und Teile zum Zeitpunkt der Erstellung und verpflichtet Sie nicht zur Beauftragung. | This cost estimate is non-binding. It is based on the assessment of the work and parts at the time of preparation and does not oblige you to place an order. |
| `estimate.free` — only freeOfCharge true | Die Erstellung dieses Kostenvoranschlags ist für Sie kostenlos. | This cost estimate is prepared free of charge. |
| `estimate.validUntil` — every estimate | Gültig bis {{validUntil}} Uhr. | Valid until {{validUntil}} (Europe/Vienna). |
| `estimate.overrun` — every non-binding estimate | Wird eine beträchtliche Überschreitung unvermeidlich, informieren wir Sie unverzüglich. Ihre gesetzlichen Rechte bleiben unberührt. | If a substantial overrun becomes unavoidable, we will inform you without delay. Your statutory rights remain unaffected. |
| `estimate.privacyReference` — with validated workshop privacy URL | Informationen zur Verarbeitung Ihrer personenbezogenen Daten: {{privacyUrl}}. | Information about the processing of your personal data: {{privacyUrl}}. |

`validUntil` includes date and minute in de-AT/Vienna from the frozen expiry instant; 14 days is product validity, not a statutory period. No “up to 15% without notice” sentence: the configurable guide is not a legal tolerance or waiver. Paid-estimate cases cannot reuse `estimate.free` or infer agreement from its omission; existing paid-estimate support/release checks must establish prior fee information/agreement before customer use. This specification adds no paid-estimate workflow.

### D. AGB reference and transactional-email privacy

| ID / applicability | German draft | English draft |
| --- | --- | --- |
| `terms.reference` — only where an identified AGB version was actually supplied/agreed in the originating workflow | Bezug genommene Allgemeine Geschäftsbedingungen: Fassung {{termsVersion}}, {{termsUrl}}. | Referenced general terms and conditions: version {{termsVersion}}, {{termsUrl}}. |
| `email.transactionalPurpose` — service mail related to an order | Diese Nachricht betrifft Ihren Auftrag {{orderNumber}} bei {{controllerName}}. | This message concerns your order {{orderNumber}} with {{controllerName}}. |
| `email.privacyReference` — controller-specific policy available | Verantwortlich für die Verarbeitung Ihrer personenbezogenen Daten ist {{controllerName}}. Informationen zu Zwecken, Rechtsgrundlagen, Empfängern, Speicherdauer und Ihren Rechten finden Sie unter {{privacyUrl}}. | The controller responsible for processing your personal data is {{controllerName}}. Information about purposes, legal bases, recipients, retention and your rights is available at {{privacyUrl}}. |
| `email.contact` — controller-specific contact available | Bei Fragen zum Datenschutz wenden Sie sich bitte an {{privacyContact}}. | For privacy enquiries, please contact {{privacyContact}}. |

AGB reference is not retroactive incorporation or proof of consent. Do not print “Es gelten unsere AGB” merely because a tenant has a URL. If no applicable AGB were supplied, omit the block without inventing a default or assuming legal incorporation. The selected version's bytes/digest or archived document reference must be available; a mutable URL/version label alone is insufficient evidence. No generic new AGB text is authored here.

The email paragraph is a **short layered notice**, not the complete GDPR information and not a consent checkbox or marketing opt-in. AUT-588 validates that the referenced controller policy supplies applicable Article 13/14 information and was provided at the required point in the customer journey; adding a footer later does not cure a missed collection notice. Service emails remain promotional-content-free under the existing consent/notification contract. No fake unsubscribe/consent wording is added to an order-ready message. Demo access mail uses its own controller/purpose and omits `orderNumber`; it must not masquerade as a workshop order message.

`controllerName`, `privacyUrl`, `privacyContact`, `termsVersion`, `termsUrl` are **new configuration/evidence prerequisites where not already available**, not inferred from ACP's platform branding or silently guessed. AUT-588 owns email controller-policy/contact resolution and validation; AUT-586 owns document AGB/notice snapshot inputs. Reuse seller/legal-entity settings when semantically correct, add narrowly scoped fields/DTOs only in those implementation plans, tenant-scoped with appropriate admin permissions. Missing required controller/notice input blocks new localised send/generation with `LEGAL_NOTICE_INPUT_MISSING`; optional unagreed AGB omission does not block. Existing archived documents and frozen retry payloads remain readable/sendable under their existing rules. No network fetch of arbitrary tenant URLs during render; validate absolute HTTPS without credentials, escape display text, freeze references and versioned evidence before enqueue.

### E. Authoritative-language and fallback notices

Both notice IDs below have **AT and DE country variants**, each with the displayed DE and EN draft text. They are separate country/language/version records with their own explicit approvals, even when the bytes match; the opening AT default does not apply to this subsection. A DE seller's margin invoice selects approved DE-country notices and its DE-country tax block. It never borrows an AT-approved notice. These presentation notices do not extend AT substantive warranty/tax applicability to DE documents.

| ID | German draft | English draft |
| --- | --- | --- |
| `language.authoritativeGerman` | Die deutsche Fassung der Rechtstexte ist maßgeblich. Die englische Übersetzung dient der Information. Zwingende gesetzliche Rechte bleiben unberührt. | The German version of the legal texts is authoritative. The English translation is provided for information. Mandatory statutory rights remain unaffected. |
| `language.englishUnavailable` | Für diesen Rechtstext liegt keine freigegebene englische Übersetzung vor. Die deutsche Fassung ist beigefügt. | No approved English translation is available for this legal text. The German version is included. |

On EN customer documents show `language.authoritativeGerman` visibly before the bilingual legal section; include both exact DE blocks and approved EN counterparts with clear language headings, readable equal type size and stable ordering. On an unavailable EN block show the DE block plus `language.englishUnavailable`; warn advisor before delivery and mark the bundle as fallback, not fully EN-approved. Do not assert that the **entire** English document is non-binding (prices, dates, promises remain part of the commercial record). For EN transactional mail, use the same legal-section notices where bilingual legal paragraphs are included, without turning ordinary English service prose into non-binding content.

No published DE block for the required country/context means `LEGAL_TEXT_UNAVAILABLE`, not an English-only or AT-for-DE fallback. Fallback never crosses jurisdiction, effective-date applicability or document kind. Runtime requires approved DE and approved notice/fallback text; an unapproved draft is not a fallback. Existing domain feature flags still apply even when all text is approved.

## Versioning, repository JSON and approval

Implement canonical immutable JSON bundles under `locales/legal/{country}/{language}/{bundleVersion}.json`, separate from mutable UI dictionaries `locales/{language}/pdf.json` and `email.json`. PDF/email namespaces hold presentation labels and references; legal bytes are not duplicated into each namespace. `bundleVersion` is a unique append-only identifier, e.g. `at-workshop-2026-10-v1`; published payloads never edited in place. Old `kv-legal-de-v1` and existing contract versions retain their historical serializers/hash algorithms.

Each entry stores `id`, `country`, `language`, `version`, `effective_from`, optional `effective_until`, `applicability_id`, `source_refs`, `status: DRAFT|APPROVED`, `approved_by`, `approved_at`, `approval_pr`, exact `paragraphs`, typed `parameter_schema`, and immutable `text_sha256`. Draft examples have null approval metadata; CI prohibits APPROVED without a recorded explicit approval. Approval is per exact country/language/version/bytes, not inherited by an EN translation from DE approval. A metadata amendment creates a new manifest/version if included in the digest; define canonical hash input once and keep approval audit outside the customer-text hash to avoid signing a moving approval record.

Resolver selection: freeze document jurisdiction + authoritative domain rule version/date → select applicable approved DE entry → EN counterpart only when its context/version pairing and approval match → otherwise DE + approved fallback notice. Resolve typed parameters, escape at the renderer boundary, snapshot exact paragraphs/parameters/id/version/country/language/source refs/hash. No tenant override/removal of code-owned blocks, arbitrary translation interpolation, runtime model translation, external translation service or silent “latest” selection on worker retry. Repeated worker execution uses frozen text. UI language changes cannot change a legal snapshot.

Dejan approval workflow:

1. Resource/content PR presents a per-block DE/EN diff, country/applicability/source changes, rendered preview and affected document types. Author marks all new text DRAFT. No automatic translation pipeline may create/publish legal resource variants; the assistant-authored DE/EN proposals in this spec are explicitly labelled drafts for human review, never auto-promoted.
2. Dejan explicitly approves the exact DE and/or EN block version in the PR (with country/version named). Mere spec merge, clean engineering review, assignment, or CI green is **not** that content approval. Technical author records review URL/identity/time in the approval manifest. Dejan may obtain Austrian counsel/Steuerberater review for substantive law/tax changes; do not fabricate that review or make a general new external gate beyond existing domain policy.
3. Publishing implementation PR verifies manifest hashes, paired-language applicability, historical-version retention, rendered DE/EN output and existing send/issue guards. Activation only uses approved resources. Rejected/changed wording receives a new draft version and a new explicit approval; no post-approval overwrite.

The user authorised this spec's PR/review/merge workflow; that does not supply approval of legal resource bytes that have not yet been implemented/reviewed. AUT-586/588 can implement selectors/fixtures using draft test resources, but cannot activate draft customer wording. No additional human gate prevents merging this documentation PR.

## Snapshot, storage and compatibility

AUT-576 adds language/version snapshot fields; AUT-586/588 implement exact legal-content freezing. Financial issue, estimate send, purchase-contract generation and outbox enqueue retain their existing atomic freeze points; no runtime live preference/policy lookup on download/retry. Credit-note language/treatment follows original invoice; preserve original applicability and select a correction-compatible legal bundle at its own issue point, never add a different exemption from today's customer/settings. Signed check-in/loaner documents follow their respective frozen evidence contracts; no new liability waiver is created here.

Freeze resolved AGB/policy references and controller identity with the document/mail as needed, plus archived AGB evidence for applicable terms. A mutable privacy URL may point to a current policy, so record the notice/policy version that was supplied; never claim hash of a URL is the hash of its content. Backend does not fetch untrusted URLs at render time. Missing required evidence is an actionable pre-issue error, not hidden after enqueue.

Hash final canonical text after all substitutions and before content commitment; preserve existing hash algorithms for historical blocks. Store full resolved text with bundle/version metadata; do not rely solely on a resource id. Hash/archive final PDF bytes only after render/upload. Keep historical resource/render versions for regeneration compatibility, but serve the original archived PDF for exact-byte evidence. Email provider retries send frozen rendered payloads/notice, not a new translation.

No schema or production JSON is added by this ticket. Owning implementation tickets must regenerate OpenAPI + generated web types if adding policy configuration or response fields, preserve tenant/site scope and existing permission/send guards, and update restore/schema manifests for new persisted fields. No new entity/deletion route here; future policy/terms archives follow the consuming evidence retention and must be included in tenant export/restore/purge. No silent extension of retention from merely adding translations.

## Legal research record and limitations

Official sources checked 16 October 2026; original product drafting, not certified statutory translations. The following explain applicability, not a complete legal opinion:

| Source | What it supports / limit |
| --- | --- |
| [USP/BMF reverse charge](https://www.usp.gv.at/themen/steuern-finanzen/umsatzsteuer-ueberblick/weitere-informationen-zur-umsatzsteuer/umsaetze-mit-auslandsbezug/reverse-charge.html), [RIS UStG §11](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10004873&Paragraf=11) | Recipient-liability note and tax-identification/no-separate-VAT requirements; does not establish eligibility for a particular workshop transaction. |
| [RIS UStG §6](https://www.ris.bka.gv.at/eli/bgbl/1994/663/P6/NOR40263533), [USP small-business overview](https://www.usp.gv.at/aktuelles/newsreihen/steuerrechtsreihe/steuerrechtsreihe-teil-6-kleinunternehmen.html), [RIS Binnenmarkt Art.11](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Artikel=11&FassungVom=2026-09-29&Gesetzesnummer=10004929) | Distinct exemption contexts; catalogue does not calculate thresholds or authorise unsupported tax profiles. |
| [RIS VGG §10](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20011654&Paragraf=10), [VGG consolidated](https://www.ris.bka.gv.at/GeltendeFassung.wxe?Abfrage=Bundesnormen&Gesetzesnummer=20011654) | Base periods/negotiation conditions and current repair extension. Existing versioned tracker applies contract-date transition; no arithmetic changes here. |
| [RIS KSchG §5](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10002462&Paragraf=5&ShowPrintPreview=True), [ABGB §1170a](https://www.ris.bka.gv.at/NormDokument.wxe?Abfrage=Bundesnormen&Gesetzesnummer=10001622&Paragraf=1170a) | Express non-binding declaration and substantial-overrun notice; no statutory fixed percentage. |
| [GDPR Articles 13/14](https://eur-lex.europa.eu/legal-content/EN/TXT/?qid=1526560528451&uri=CELEX%3A32016R0679) | Controller-specific information duties; a generic footer is not complete compliance or consent. |

Direct RIS requests were intermittently unavailable; search-indexed official versions were used where needed, with exact links above. Existing DE margin wording is source inventory, not fresh German tax-law certification; DE country approval remains separate. A “DE authoritative” clause is not a verified answer for every consumer/language situation. No universal AGB/privacy policy is authored, and no domain-specific mandatory distance-contract/withdrawal information is replaced by these snippets. Existing AUT-353/ADR-0025 legal/release requirements remain in effect.

## Implementation mapping and acceptance tests

| Owner | Deliverable |
| --- | --- |
| AUT-576 | Language/schema integration points and compatible snapshots; keep historical bytes. |
| AUT-586 | Versioned legal resolver/manifest, PDF bilingual blocks/notices, document-context/AGB evidence, new renderer version for base-date wording; preserve unsupported tax mode guards. |
| AUT-588 | Email-specific controller policy/contact config, frozen footer/notice/template versions and DE/EN mail snapshots. |
| Dejan in resource PRs | Exact per-country/per-language content approval; no approval is recorded by this spec. |

Required CI tests for implementation (not locally executed here):

- Real DE resources are default fixtures; explicit EN cases use actual EN content, never identity `t()` mocks. Verify every catalogue id has DE/EN draft/approved variants and typed parameter parity; no empty text or raw key leakage.
- Applicability matrix: AT vs DE seller independent of UI/customer language; STANDARD vs margin; unsupported RC/small-business/intra-community cannot be enabled by zero tax or selecting a language. No contradictory note combination. EN invoice for a DE seller with approved DE-country margin and notice variants succeeds; missing DE-country approval blocks/falls back only as specified, never substitutes AT notice approval.
- Warranty: B2B has no computed end-date paragraph/exclusion; explicitly test B2B with v2 and a post-1-October-2026 contract still omits consumer presumption/base-date/repair-extension text. Consumer standard/qualified shortening use existing guards; invalid negotiated shortening blocks; v2 repair-extension note follows frozen consumer rule, base date never described as end of all rights; guarantee remains separate with original terms.
- Estimate: non-binding/free/validity/overrun/privacy blocks, paid case not represented as free, expiry Vienna/de-AT, no statutory 15% allowance, legal text above approval controls.
- Approval/fallback: DRAFT not publishable; absent/mismatched EN uses approved DE plus availability notice/warning; absent DE/wrong country blocks; exact paired version approvals required. Dejan approval metadata cannot be synthesised by CI or spec merge.
- AGB/privacy: optional unagreed AGB omitted; agreed version references/archived evidence retained; missing required controller policy/contact fails before send; no wrong-controller default, fake consent or promotional text. HTTPS/credential/header/HTML injection inputs rejected or escaped appropriately; no server-side arbitrary-URL fetch.
- Rendering/archive: DE plus EN legal sections readable, no clipping, notice before bilingual blocks; legacy PDF/text/hash unchanged; changed locale/config/resources after freeze cannot change archive or retry mail; final PDF digest matches stored bytes.
- Tenant/site/RBAC: config/evidence from another tenant or unauthorised site never used; customer flow cannot remove mandatory blocks or enable sending/issuance through locale parameters. New persistent evidence participates in restore/purge coverage.

Acceptance for AUT-587: this Markdown catalogue merged; complete DE text inventory and EN draft present; version/country/fallback/approval responsibilities explicit. Production JSON, translations, device validation, counsel review and customer activation are **not** claimed by spec CI.
