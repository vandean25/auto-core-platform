# Country pack and effective capabilities

## Contract

The backend country registry is the source of truth for country policy. It lives in `apps/core-api/src/common/country-pack/country-pack.registry.ts`, follows the accounting-export registry pattern and is keyed by `LegalEntity.country_iso`. There is no shared package or frontend copy. Supported countries remain `AT | DE`; there is no schema change.

| Capability or default | AT | DE |
| --- | --- | --- |
| `nova` | true | false |
| `pickerl57a` | true | false |
| `kaufvertragAt` | true | false |
| `willhabenExport` | true | false |
| `defaultVatRate` | 20 | 19 |
| `marginSchemeNoteKey` | AT | DE |
| `validateVatId` | ATU + eight digits | DE + nine digits |
| `validateTaxNumber` | two / three / four digits; slashes optional | nine to thirteen digits; spaces/slashes ignored |
| `defaultAccountingProfile` | ACP-RZL-AT-EUR-1 | ACP-DATEV-DE-EUR-1 |
| `locale` | de-AT | de-DE |
| `timeZone` | Europe/Vienna | Europe/Berlin |
| `sellerTaxIdentifier` | vat_id | tax_number_or_vat_id |
| `vatIdLabelKey` | invoice.uidLabel | invoice.vatIdLabel |
| `vatIdLabel` | UID | USt-IdNr. |

VAT identifiers are uppercased and whitespace is removed before format validation. These are format checks, not tax-authority verification. Margin-note keys resolve the existing authoritative legal text without changing it. Entries and capability objects are immutable.

`resolveCountryPack` throws `UnsupportedCountryError` for unknown, missing or incorrectly cased countries; it never assumes Austria. `findCountryPack` returns `undefined` for callers that intentionally permit other countries. Customer country normalization, third-country validation bypasses and blank-country import validation are preserved by their callers.

## Session and isolation

`GET /api/auth/me` and `POST /api/auth/switch-tenant` return the required nullable `effectiveCapabilities` field next to `formatLocale`. Only the country pack contributes today; tenant module toggles are not implemented here.

The country is resolved from the user's active site's legal entity, not from a request country or token tenant claim. The lookup requires the active tenant, active site, active legal entity, active site membership and active tenant membership, scoped to the authenticated user's database identity. Without authorized active legal-entity context, capabilities are `null`, not Austrian defaults. Switching tenants clears the active site and therefore capabilities. Authentication-only resolution does not query the country registry's database context.

The Swagger DTO generates the OpenAPI contract and `apps/core-web/src/api/generated/openapi.ts`. `EffectiveCapabilities` in the existing web auth-session module aliases that generated DTO. `selectEffectiveCapabilities(session)` returns the exact session flags or `null` for unavailable context; it does not infer policy from locale or country.

## Compatibility and AUT-686

This ticket exposes policy but does not gate any UI, endpoint or export. AUT-686 should consume `selectEffectiveCapabilities(useAuthSession().data)`, preserve loading/error states, and require a flag to be explicitly `true` before enabling a country-specific action. Backend authorization must independently resolve effective capabilities; browser flags are not authorization. Later module toggles belong in the effective-capability resolution, not in a second frontend map.

Pack VAT and locale defaults are metadata for country-aware initialization. This ticket does not replace existing invoice VAT fallbacks, stored snapshots, tenant/user locale preferences or explicit site settings. In particular, legacy DE documents can retain 20% fallback VAT and de-AT formatting. AT behavior, accounting release gates, legal note wording, missing-field ordering and document language are unchanged.

Tyre profile selection and thresholds remain in the tyre evaluator to avoid changing parallel tyre work. Holiday-client `DE` selects the German language, not Germany, and is not a country-pack lookup. Statutory invoice/contract rules, frozen allocation-country checks and frontend legal-entity settings guards remain in their domains; AUT-686 feature gating is deferred.

The seller IBAN-length map validates the bank-country prefix independently of the seller country. Vehicle valuation still requests the provider's fixed Austrian market. Document-branding previews retain their sample-country dispatch. Site creation retains its explicit Vienna fallback for unsupported strings as a tested compatibility exception; supported legal-entity countries still resolve AT/DE pack time zones. Legacy PDF labels retain their third-country fallback.

## Adding a country

1. Obtain a separate decision to expand the supported legal-entity country list; this ticket keeps it AT/DE.
2. Add a typed registry entry with explicit capabilities, defaults, validators and document/readiness metadata. Do not inherit AT implicitly.
3. Provide reviewed legal text for the margin-note key, accounting serialization support and country-specific regression cases. Capability flags do not release an accounting serializer.
4. Test every default and flag, unknown-country handling, validation boundaries and session isolation. Add caller-specific tests before replacing any country dispatch.
5. Regenerate OpenAPI and web types when the contract changes. Keep the map exclusively in core-api and preserve existing stored document semantics.

## Verification

Synthetic fixtures cover complete AT/DE packs, unsupported countries, validation and default dispatch regressions, PDF text parity, customer import behavior, session capabilities and revoked-context/tenant isolation. Web selector tests verify verbatim session flags and null handling. No screenshots or real customer data are required.
