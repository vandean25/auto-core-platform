---
title: "Live TecDoc parts fitment behind the catalog contract"
date: "2026-10-16"
module: "Vehicle"
status: draft
linear-project: "Vehicle Intelligence & Parts Catalog"
linear-milestone: "M4 Wholesaler B2B (later)"
tags:
  - feature-spec
  - vehicle
  - catalog
---

# Live TecDoc parts fitment behind the catalog contract

## Summary

OEM and aftermarket catalog calls still run through sandbox adapters. The aftermarket parts sandbox labels its rows `sourceSystem: "tecdoc"`. That label is not a TecDoc catalogue response. This spec pins one licensable parts-fitment contract, maps it onto the existing `PartsCatalogProvider` port, and keeps manufacturer labour times on a separate product that this adapter does not implement.

The contract is TecAlliance **TecDoc Web Service**, interface **TecdocToCat**, published as **WEB SERVICE 3.0** under the path **pegasus-3-0**, JSON document-literal bare. Checked against commit `0ebe5d8107322a4bd839c4f6623669ed22b07e6e`. Public pages were read on 2026-10-16. The normative fixtures are [catalog-live-provider.fixtures.json](./catalog-live-provider.fixtures.json). Every article number, vehicle id, EAN, and price in that file is synthetic. The workshop in those fixtures is the pilot customer.

This document is the AUT-525 deliverable. It does not buy a provider seat, open a network connection, scrape a catalogue, or ship product code. AUT-534 is the implementation issue and stays blocked until this spec is accepted. Local contract tests load the fixture file and wait on no TecAlliance contact.

The folder for this spec is `docs/internal/02-Feature-Specs/Vehicles/`. New vehicle specs landed there on 2026-10-15 and 2026-10-16 (Zulassungsschein intake, NoVA, nationalcode valuation). The August 2026 catalog spec remains at `docs/internal/02-Feature-Specs/Vehicle/2026-08-28-vehicle-intelligence-and-parts-catalog.md`. This document links to it and does not move it.

No new ADR. [ADR-0021](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md) already split parts and labour into ports and left TecDoc as a commercial aftermarket adapter. This spec names the contract that fills the parts port. It adds no entity, status machine, or ledger path.

---

## User Stories

- As a **service advisor**, I want an aftermarket parts search that uses a real TecDoc vehicle link so that a hit is a catalogue article linked to the stored TecDoc car, and a miss stays a miss.
- As a **service advisor**, I want several links, several articles, or a conditional attribute to stay ambiguous so that I do not add a single “verified” line by accident.
- As a **tenant admin**, I want the live adapter off until a provider id, API key, country, language, and data-rights note exist so that sandbox rows cannot be billed as TecDoc fitment.
- As a **workshop owner**, I want labour times to stay on their own contract so that a parts hit never shows a manufacturer AW value.

---

## Verified current behavior

| Fact | Where it lives |
|---|---|
| `PartsCatalogProvider.search` and optional `listAssemblyGroups` return `CatalogPartsHit`. `LaborCatalogProvider.search` returns `CatalogLaborHit` with optional `standardAw` and `plannedHours`. | `parts-catalog.provider.ts`, `labor-catalog.provider.ts`, `catalog-provider.types.ts` |
| `CatalogModule` binds both ports to sandbox composites. An adapter id that contains `aftermarket` is sent to the aftermarket sandbox. | `catalog.module.ts` |
| The aftermarket parts sandbox returns one row with `sourceSystem: "tecdoc"`, `externalId` prefixed `tecdoc-`, brand label `Bosch`, a fixed `unitPrice` of `79.99`, and EAN `4012345678901`. | `sandbox-aftermarket-parts.provider.ts` |
| The aftermarket labour sandbox returns `sourceSystem: "haynes"` and a fixed `standardAw`. It is not TecDoc and not TecRMI. | `sandbox-aftermarket-labor.provider.ts` |
| External search is `GET /api/catalog/external/search`. Parts hits expose `unitPrice` as a required number. `costPriceEst`, `ean`, `unit`, `fitmentNotes`, and `oemNumbers` are optional. | `catalog-external-search.dto.ts` |
| Add-to-order rejects a parts hit whose `unitPrice` or `articleNumber` is missing (`Incomplete catalog hit token`). JIT upserts `CatalogItem` on `(tenant_id, source_system, external_article_id)` and writes no stock ledger row. | `workshop-catalog-line.service.ts`, ADR-0021 |
| `identity_keys` is JSON on `Vehicle`. The sandbox identity provider writes `{ vin }`. It does not write a TecDoc car id. | `vehicle-identity.provider.ts`, `schema.prisma` |
| `CatalogProviderSettings` stores aftermarket adapter ids and secret refs. It has no country or language column. | `schema.prisma` |
| Estimate customer-send blockers are `ZERO_UNIT_PRICE` and `CLAIMED_FITMENT`. `CLAIMED_FITMENT` is raised when `fitment_notes` is non-empty. Send throws `422` with `code` `ESTIMATE_CUSTOMER_SEND_BLOCKED` and a `blockers` array. There is no fitment `Verified` status. | `workshop-estimate-lines.helpers.ts`, `workshop-estimate.service.ts` |
| `GlobalExceptionFilter` forwards `code` only when it is in `CLIENT_SAFE_HTTP_ERROR_CODES`. `ESTIMATE_CUSTOMER_SEND_BLOCKED` is not in that set, so production drops `code` and `blockers`. The thrown message still names zero-price and claimed-fitment lines. | `client-safe-http-error-codes.ts`, `global-exception.filter.ts` |
| Catalog e2e expects aftermarket `sourceSystem` to be `tecdoc`. | `apps/core-api/test/catalog-external.e2e-spec.ts` |
| Direct aftermarket search does not catch `CatalogProviderError`. The OEM chain catches it and can fall through to aftermarket. | `catalog-router.service.ts` |

---

## Decisions

1. **One parts contract.** The live aftermarket parts adapter speaks TecDoc Web Service, TecdocToCat, WEB SERVICE 3.0, path `pegasus-3-0`, JSON document-literal bare, endpoint `https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint`. The public function index retrieved on 2026-10-16 lists 55 TecdocToCat functions. The public changelog’s 13th revision (recommended retail prices limited to parts distributors since 22 October 2024) is the documentation revision, not a service `revision` field to hard-code.
2. **Passenger cars only.** `linkingTargetType` is `P`. The method text and the functions guide both define `P` as passenger cars. This slice does not call `O`, `L`, `M`, `A`, `K`, `U`, or `PO`.
3. **Vehicle key is `carId`, stored under `TECDOC`.** The functions guide writes the fitment argument as `linkingTargetId(carId)`. `getVehicleIdsByKTypeNumber` takes `typeNumber` (“TecDoc-KType or NType”) and returns `carId` (“Vehicle ID”). Those two numbers stay separate. The parts adapter reads `identity_keys.TECDOC.carId` and `identity_keys.TECDOC.linkingTargetType`. It never sends `typeNumber` as `linkingTargetId`. It never decodes a VIN and never writes `identity_keys`.
4. **Article identity is `articleId`.** `external_article_id` and `CatalogPartsHit.externalId` are the decimal `articleId`. `articleLinkId` is the linkage id and is stored beside the article, not as the catalog key. `articleNo` maps to `articleNumber`. `brandName` maps to `brandLabel`.
5. **Fitment is an intersection, then one detail call.** A non-empty advisor query is an exact article-number search (`numberType` 0, `searchExact` true). Rows whose returned `numberType` is anything other than 0 are dropped. The remaining `articleId` values are confirmed with `getArticleIdsWithState` for the stored `carId`. A unique hit is one `articleId` with one `articleLinkId`, followed by `getAssignedArticlesByIds7` for that pair. The functions guide’s step 9 still names `getAssignedArticlesByIds6`. The public index also lists `getAssignedArticlesByIds7` as the later “incl. URLs” detail call. This slice calls 7. Direct search alone is not fitment: the guide says `getDirectArticlesByIds6` cannot return linking-target data such as fitting position.
6. **Prices stay unmapped.** `articlePrices.price` is an integer whose scale is not stated. `normalAustauschPrice.price` is described as an integer “with 2 decimal spaces”, which is still not a formula. The 13th changelog revision limits recommended retail prices to parts distributors. This slice sends `prices: false` and `normalAustauschPrice: false`. `unitPrice` and `costPriceEst` are null. `packingUnit` and `quantityPerPackingUnit` are not ACP `unit`. `quantityUnitName` lives on a price row, so `unit` is null while prices are off.
7. **Labour is a different product.** The same TecAlliance catalogue page sells **TecRMI Repair & Maintenance Data**, including manufacturer labour times, as its own API or frontend. The TecdocToCat function index contains no labour or AW function. This adapter implements `PartsCatalogProvider` only. It leaves `standardAw` and `plannedHours` unset. It does not register a labour adapter id.
8. **The live adapter is default-off.** Adapter id `tecdoc-pegasus-3-0-parts` is invoked only when `CATALOG_TECDOC_PARTS_ENABLED` is `true` and the tenant secret has provider id, API key, `articleCountry`, and `lang`. Otherwise the call is not made. The id does not contain the substring `aftermarket`, because today’s composite routes that substring to the sandbox.
9. **Sandbox rows are visibly synthetic.** The follow-up changes the parts sandbox to `sourceSystem: "sandbox-tecdoc"`, names that start with `Synthetic `, and article numbers that start with `SYN-`. `synthetic` is true. Those rows fail the live-fitment predicate below. Existing sandbox rows whose `external_article_id` starts with `tecdoc-` also fail it, because a live id is a decimal `articleId`.
10. **No catalogue cache in Postgres.** Search stays ephemeral, as in ADR-0021. An in-process cache may keep a fixture-shaped response for at most the existing hit-token TTL of 15 minutes, keyed by provider id, country, language, `dataVersion`, `carId`, linking type, and the exact article number. Process exit drops it. TecDoc payloads are not inserted into `CatalogItem` until Add to order, and Add to order of a priceless or ambiguous hit is refused.

---

## Scope

In scope: the TecdocToCat JSON calls in the fixture file, the mapping matrix, the sandbox source-system rule, and the default-off follow-up for AUT-534.

Out of scope: buying a TecAlliance seat, contacting TecAlliance, scraping, TecDoc IDP data-package sync, TecdocToBusiness ordering, supplier stock, lead time, VIN or VRM decode, plate registries, OEM catalogs, TecRMI labour, commercial-vehicle and motorcycle linkage, and merging OEM and TecDoc rows by EAN.

---

## Provider contract

### Source

| Item | Pinned value |
|---|---|
| Product page | [TecAlliance catalogue & eCommerce](https://www.tecalliance.net/products?solution=catalogue-ecommerce), card “TecDoc Web Service”, read 2026-10-16 |
| Info site | `https://webservice.tecalliance.services/pegasus-3-0/info/` — HTML title `WEB SERVICE 3.0`; response `Last-Modified: Wed, 10 Sep 2025 12:22:23 GMT` |
| Function index | `.../info/src/service/resource/tecdoctocatfunctionList.json` |
| Method text | `.../info/src/service/resource/methods/<function>.json` |
| Search guide | `.../info/src/documents/guide/resource/cat/vehicleByModel.json` and `articleDirectSearch.json` |
| Status codes | `.../info/src/info/resource/statuscodes/data.json` section “1.3.2 Status codes” |
| JSON example | `.../info/src/examples/resource/php/sourceCodes/json/basics_2_0.php` sets `SERVICE_URL` to the endpoint below and `TECDOC_MANDATOR` to the provider id |
| Endpoint | `POST https://webservice.tecalliance.services/pegasus-3-0/services/TecdocToCatDLB.jsonEndpoint` |
| Body | One object whose single key is the function name |

Re-read those URLs at implementation time. If `getAssignedArticlesByIds7` or `linkingTargetType` `P` disappears from the public index, stop and revise this spec. A third-party XSD that documents `getArticles` and a different meaning for `P` is not this contract. China OneDB (`onedb.tecalliance.cn`) and the SEA host (`vin.tecalliance-sea.com`) are not this contract. OptiCat AutoCare on `webservice.opticatonline.com` is not this contract. The IDP Data Receiver API is a delta feed for data-package holders; its `articles/get` endpoint was removed on 24 April 2025. It is not the workshop fitment call.

### Auth

Every pinned function requires `provider`, the integer “Provider ID given by TecDoc”. The info site’s HTTP client sets header `X-API-Key` (`CommunicationFactory.setAPIKey` in `pegasus-3-0/info/app.js`). The PHP sample shows the provider id and does not show the header. This slice sends both. The key stays out of the URL. The official sample’s query string has no `api_key`.

`addDynamicAddress` documents an address allowlist: it may be called only from an existing static address, and it grants a temporary address for 1 to 24 hours. The adapter does not call `addDynamicAddress`. Opening the allowlist is an operations step on the live prerequisite list.

Secrets live in the existing `parts_aftermarket_credentials_secret_ref`. The JSON shape is `providerId`, `apiKey`, `articleCountry` (ISO 3166, as the method text requires), and `lang` (ISO 639). Country and language are configuration stored next to the key so this slice adds no column. Logs print the provider id and country and omit the key. There is no built-in country default. A missing field is a configuration error and does not call TecDoc.

### Region

The TecDoc status page lists Web Service regions AWS `EU-Central-1`, `US-West-2`, and `AP-Northeast-1`. The pinned endpoint has no region argument. This slice calls that host only. It does not select a region in code. Whether the hostname is geo-routed is not stated on the info site. Before the flag is turned on, the licensed profile’s region is confirmed by the person who holds the contract. That confirmation is a prerequisite, not a code change.

### Rate limit, overload, and timeout

The public status table is: `200` OK, `400` invalid request, `401` request not authorized, `402` timeout, `405` method not allowed, `413` too many results, `500` internal error. No requests-per-minute figure is published. `413` is “Too many results found”. It is not a rate limit. HTTP `429`, with or without a body, is the rate-limit fixture. The adapter makes one attempt and returns `PROVIDER_RATE_LIMIT`. It does not invent a `Retry-After` delay.

`402` and a transport timeout are both `PROVIDER_TIMEOUT`. `401` is `PROVIDER_UNAUTHORIZED`. `400`, `405`, and `500` are `PROVIDER_REJECTED`. `413` is `PROVIDER_TOO_MANY_RESULTS`. Each of these returns no hits. A `413` is not treated as “no such article”. Partial arrays are not returned as unique fitment.

These failures on the aftermarket path stay failures. Today a `CatalogProviderError` during direct aftermarket search is uncaught. The follow-up throws the HTTP statuses in the API table and does not convert them into a 200 with an empty success list. Empty success is only TecDoc `status` 200 with `data.empty` true, or a 200 id list that does not contain the requested `articleId`. The follow-up adds each new `code` to `CLIENT_SAFE_HTTP_ERROR_CODES`, because a code outside that set is removed in production.

### Cache

`getPegasusVersionInfo2` returns `dataVersion` (“Version of the data itself (MM/YYYY)”), `refDataVersion` (`MMYY`), and service `major`, `minor`, `revision`, `build`. The function text says to use `getVersionInfo` instead. `getVersionInfo` is absent from the 55-function index read on 2026-10-16, so this slice calls `getPegasusVersionInfo2` and stops if that call fails. A search without a version is not served.

The in-process cache key includes that `dataVersion`. Entries older than 15 minutes (`CATALOG_HIT_TTL_SECONDS`) are dropped. There is no Redis key and no cache table.

### License

Live use needs a TecAlliance TecDoc Web Service licence whose provider id is allowed to read passenger-car linkage for the configured `articleCountry`. Recommended retail prices are a separate distribution right (changelog revision 13, 22 October 2024). This slice does not request prices, so it does not depend on that right. TecRMI labour times are a separate right and are not included. Storing the TecDoc catalogue in `CatalogItem` ahead of Add to order remains forbidden by ADR-0021.

The adapter is enabled only after the tenant secret exists and a recorded note names the licence holder as the pilot customer’s contracting party, the provider id (not the key), the country, and whether prices are included. Price inclusion does not by itself map integers onto `unitPrice`; the scale is still unmapped. Local tests use `providerId: 0` and `apiKey: "REDACTED"` from the fixture file.

---

## Call sequence

Configured secret fields: `providerId`, `articleCountry`, `lang`. Stored vehicle fields: `TECDOC.carId`, `TECDOC.linkingTargetType === "P"`. Advisor `query` is trimmed.

1. Missing secret, flag off, or wrong vehicle key: return the matching error. Zero HTTP calls.
2. `getPegasusVersionInfo2` with `{ provider }`. Failure uses the status map. Success keeps `dataVersion` for the cache key and the hit.
3. Empty `query`: return no hits. Assembly groups are `listAssemblyGroups`, not search.
4. `getArticleDirectSearchAllNumbersWithState` with `articleNumber` = query, `numberType` 0, `searchExact` true, `sortType` 1 (documented sort “1: Brand”). Omit `brandId` and `genericArticleId`. Keep rows with `numberType` 0.
5. Zero kept rows, or `data.empty` true: no match.
6. More than one distinct `articleId`: ambiguous. Do not call detail. Do not add to order. The listed rows use the direct-search `articleName`, `articleNo`, and `brandName`, with null price, null EAN, and `linkageOutcome: "ambiguous"`.
7. One `articleId`: `getArticleIdsWithState` with `linkingTargetId` = `carId`, `linkingTargetType` `P`, `sort` 1, and `brandNo` / `genericArticleId` from that row. The JSON object definition types those two as `IntegerList` (`{ array: number[] }`), and `articleIdPairs` as `{ array: [{ articleId, articleLinkId }] }` with a documented maximum of 25. Keep state rows with the same `articleId`.
8. Zero kept state rows: no match. More than one `articleLinkId`: ambiguous, no detail call.
9. One pair, and the pair count is within the documented maximum of 25: `getAssignedArticlesByIds7` with that `articleId` and `articleLinkId`, the same linking target, and the flags in the `hit` fixture (`prices` and `normalAustauschPrice` false; `basicData`, `eanNumbers`, `oeNumbers`, `attributs`, and `immediateAttributs` true; other include flags false).
10. Detail status other than 200: the status map. One detail record that passes the unique-linkage rules: one `CatalogPartsHit`. Otherwise ambiguous and no add-to-order.

`listAssemblyGroups` calls `getChildNodesAllLinkingTarget2` with `linked` true, `childNodes` true, `linkingTargetId` = `carId`, `linkingTargetType` `P`, and `parentNodeId` null for the root. The response is flat: `parentNodeId` null means a root, and `hasChilds` is the documented child flag. The adapter builds `CatalogAssemblyGroupNode.children` from `parentNodeId`. `id` is the decimal `assemblyGroupNodeId`. `name` is `assemblyGroupName`.

---

## Mapping matrix

Public text is quoted from the method JSON or the functions guide read on 2026-10-16. “Unmapped” means the ACP field stays null or omitted. It is not filled with a guess.

| Provider field | Public meaning | ACP field | Mapping |
|---|---|---|---|
| `provider` | Provider ID given by TecDoc | secret `providerId` | Sent on every call. Never returned to the client. |
| `articleCountry` | Country code according to ISO 3166 | secret `articleCountry` | Sent as configured. No code default. |
| `lang` | Language code according to ISO 639 | secret `lang` | Sent as configured. No code default. |
| `linkingTargetType` `P` | Passenger car | `identity_keys.TECDOC.linkingTargetType` | Must already be `P`. |
| `linkingTargetId` / guide `linkingTargetId(carId)` | Linking target id, written as carId | `identity_keys.TECDOC.carId` | Sent as `linkingTargetId`. |
| `typeNumber` | Type number; function text says KType or NType | `identity_keys.TECDOC.typeNumber` | Stored only. Never sent as `linkingTargetId`. |
| `carId` on vehicle responses | Vehicle ID | same `TECDOC.carId` | The parts adapter does not fetch it. |
| `articleId` | Article ID | `externalId`, `CatalogItem.external_article_id` | Decimal string. |
| `articleLinkId` | Article link id | hit `articleLinkId`, `CatalogItem.specs.tecdoc.articleLinkId` | Not the upsert key. |
| `articleNo` | Article number | `articleNumber` | Direct. |
| `articleName` | Article name | `name` | Direct. `articleAddName` is unmapped. |
| `brandName` / `brandNo` | Brand name / brand number | `brandLabel`; `specs.tecdoc.brandNo` | Name is the label. Number is specs only. |
| `genericArticleId` | Generic article ID | hit `genericArticleId`, `specs.tecdoc.genericArticleId` | Product group id. No `CatalogPartsHit` product-group column exists today. |
| `genericArticleName` | Generic article name | hit `genericArticleName`, `specs.tecdoc.genericArticleName` | Not copied into `name`. |
| `eanNumber` | EAN number | `ean` | Exactly one value maps. Zero values leave `ean` null. Two or more values make the hit ambiguous and leave `ean` null. |
| `oenNumbers[].oeNumber` | OE number | `oemNumbers` | Every value, in response order. `brandName` on that row is the manufacturer name in the method text and is unmapped. |
| `articlePrices`, `normalAustauschPrice` | Catalog price; retail/reconditional price | `unitPrice`, `costPriceEst` | Unmapped. Flags are false. Both ACP fields are null. Integer scale is not stated. |
| `quantityUnitName` | Quantity unit name (KT 071, example Piece) on a price row | `unit` | Unmapped while prices are off. |
| `packingUnit`, `quantityPerPackingUnit` | Packing unit; quantity per packing unit | `unit` | Unmapped. They are integers, not a unit code. |
| `articleAttributes`, `immediateAttributs` | Attribute name, value, unit, and `attrIsConditional` | `linkageOutcome`; raw copy in `specs.tecdoc.attributes` on add | Any `attrIsConditional: true` makes the hit ambiguous. Attribute text is not written to `fitmentNotes`. Attribute type “Others tbd” stays unmapped. |
| `dataVersion` | Data version `MM/YYYY` | hit `dataVersion`, `specs.tecdoc.dataVersion` | From `getPegasusVersionInfo2`. |
| `status` | Status code in HTML to lean on | adapter error code | See the status map. `200` with rows continues. |
| `statusText` | Error text if status > 200 | omitted | The status table does not fix the text. Fixtures use null. The adapter does not match on text. |
| Labour / AW | Not a TecdocToCat field | `standardAw`, `plannedHours` | Unset. TecRMI is a separate product. |
| Stock, lead time | Not a TecdocToCat search field | none | Unmapped. TecdocToBusiness is out of scope. |

`CatalogItem.specs` is existing JSON. The follow-up writes `specs.tecdoc` only inside the existing JIT upsert, and only for a unique, non-synthetic hit that the advisor adds. Search itself writes nothing.

---

## Linkage outcomes

| Outcome | Rule | Add to order |
|---|---|---|
| `unique` | One `articleId`, one `articleLinkId`, detail status 200, no conditional attribute, at most one EAN | Refused while `unitPrice` is null, by the existing incomplete-token check |
| `no-match` | Status 200 and `data.empty`, or the linked id list does not contain the article | No row |
| `ambiguous` | More than one article, more than one link id, a conditional attribute, or more than one EAN | Refused with `422` `AMBIGUOUS_LINKAGE` |
| `wrong-vehicle-key` | `TECDOC.carId` missing, not a positive integer, or `linkingTargetType` other than `P` | No call, no row. Code `WRONG_VEHICLE_KEY` |
| `synthetic` | Sandbox parts adapter | Cannot satisfy the live predicate |

Broken provider responses (`400`, `401`, `402`, `405`, `413`, `500`, HTTP `429`, transport timeout) produce the error codes in the fixture file and an empty hit list.

---

## Live fitment predicate

A parts line is eligible for a live fitment outcome only when all of these hold:

- `source_system` is `tecdoc`
- `external_article_id` is a decimal `articleId`
- the hit claim `synthetic` is false
- `linkageOutcome` is `unique`
- `CATALOG_TECDOC_PARTS_ENABLED` was `true` when the hit token was signed

Sandbox output fails this predicate. `sourceSystem` `sandbox-tecdoc`, `synthetic: true`, and the current sandbox id prefix `tecdoc-` are each enough. The follow-up adds estimate blocker `SYNTHETIC_CATALOG` for a line whose catalog source is `sandbox-tecdoc` or whose external id still has the sandbox prefix `tecdoc-`. That blocker is separate from `CLAIMED_FITMENT`, which stays tied to non-empty `fitment_notes`. This adapter writes `fitmentNotes` null, so a live unique hit does not trip `CLAIMED_FITMENT`.

There is no `Verified` enum in the estimate API today. The predicate is the rule a later verified status has to use. Until that status exists, sandbox rows still cannot pass it. A synthetic line is a send blocker `SYNTHETIC_CATALOG` on the existing `422` `ESTIMATE_CUSTOMER_SEND_BLOCKED`. The follow-up extends that exception’s message so it names synthetic catalog lines, and it allowlists `ESTIMATE_CUSTOMER_SEND_BLOCKED` so production keeps `code` and the `blockers` array.

---

## Labour capability

| Capability | Contract | This adapter |
|---|---|---|
| Parts fitment, article, EAN, OE number, generic article | TecDoc Web Service, TecdocToCat, WEB SERVICE 3.0 | Implemented by the follow-up, default off |
| Manufacturer labour times (AW), overlap, OE job numbers | TecRMI Repair & Maintenance Data, listed on the same catalogue page as its own API or frontend | Not implemented. No TecRMI function version is pinned here, because this spec does not select that contract |
| Sandbox labour | `sandbox-aftermarket-labor`, `sourceSystem` `haynes`, fixed `standardAw` | Stays sandbox. Those AW values are sandbox numbers. They are not TecRMI and not TecDoc |

A later labour spec has to pin a TecRMI version the same way this document pins TecdocToCat. Until then, no adapter may put a manufacturer AW on a TecDoc parts hit.

---

## Database Impact

### New Tables / Columns

| Table | Column | Type | Nullable | Notes |
|---|---|---|---|---|
| — | — | — | — | No new table or column. Country, language, provider id, and API key sit in the existing parts secret ref. |

### Modified Tables

| Table | Change | Migration Required? |
|---|---|---|
| `CatalogItem.specs` | On JIT of a unique live hit, write `tecdoc.articleId`, `articleLinkId`, `brandNo`, `genericArticleId`, `genericArticleName`, `dataVersion`, `carId`, `linkingTargetType` | No. Existing JSON. |
| `Vehicle.identity_keys` | A future identity adapter may store `TECDOC.carId` and `TECDOC.linkingTargetType`. This parts adapter only reads them | No write in this slice. |

### Deletion Policy Impact

No new entity. `CatalogItem` stays non-deletable under the current API. `CatalogProviderSettings` stays update-in-place. The in-process cache is not a stored entity. `docs/deletion-policy.md` stays as it is.

Search and a failed provider call write no `InventoryTransaction` and no `InventoryStock`. JIT still follows ADR-0021: a catalog row on add, no ledger row until a real receipt.

### State machines

No new status and no new transition. Ambiguous and synthetic hits are refused before a workshop line exists. Estimate blockers gain `SYNTHETIC_CATALOG` in the follow-up; `ZERO_UNIT_PRICE` and `CLAIMED_FITMENT` stay.

### Real-time sync

No new entity. `SUPPORTED_ENTITY_TYPES` and the dashboard entity map stay unchanged.

### Fiscal

No invoice, credit note, or lock-date change. A null `unitPrice` cannot be added, so this slice does not create a priced line.

---

## API Contract Changes

This docs change does not modify HTTP. The follow-up does.

### New Endpoints

| Method | Route | Request Body | Response | Auth |
|---|---|---|---|---|
| — | — | — | — | — |

### Modified Endpoints

| Method | Route | Change Description |
|---|---|---|
| GET | `/api/catalog/external/search` | Parts items gain nullable `unitPrice` and optional `genericArticleId`, `genericArticleName`, `dataVersion`, `articleLinkId`, `synthetic`, `linkageOutcome`. Labour items are unchanged. No-match and ambiguous results stay HTTP 200. `WRONG_VEHICLE_KEY` is HTTP 422. `PROVIDER_UNAUTHORIZED`, `PROVIDER_TOO_MANY_RESULTS`, and `PROVIDER_REJECTED` are HTTP 502. `PROVIDER_RATE_LIMIT` is HTTP 429. `PROVIDER_TIMEOUT` is HTTP 504. Each of those codes is added to `CLIENT_SAFE_HTTP_ERROR_CODES`. |
| POST | `/api/workshop/orders/:id/tasks/:taskId/lines/from-catalog` | Unique live hit with null `unitPrice` keeps today’s rejection. Ambiguous hit returns `422` `AMBIGUOUS_LINKAGE`, also allowlisted. |
| POST | existing estimate customer send | Blocker enum gains `SYNTHETIC_CATALOG`. The HTTP code stays `ESTIMATE_CUSTOMER_SEND_BLOCKED`. That code is allowlisted, and `blockers` is forwarded. |

### OpenAPI Regeneration

The follow-up runs both commands and commits both artifacts. This spec PR does not.

- [ ] `npm --prefix apps/core-api run openapi:generate`
- [ ] `npm --prefix apps/core-web run api:types:generate`

---

## UX Compliance

No new page and no new list. External search already renders hits. The follow-up shows the word `Synthetic` on a hit with `synthetic: true` or `sourceSystem` `sandbox-tecdoc`, in the existing result list. Page-level actions, DataTable rules, and auto-save do not change. `linkageOutcome` `ambiguous` is shown as ambiguous text on that row. `StatusBadge` gains a label only if a new status cell is introduced; this slice does not add one.

### Real-Time Sync

- [ ] No new entity type. `SUPPORTED_ENTITY_TYPES` stays unchanged.
- [ ] `dashboard-entity-map.ts` stays unchanged.

---

## Component Design

| Component | Location | Purpose |
|---|---|---|
| — | — | No new React component in this spec. The follow-up marks synthetic hits inside the existing external-search result. |

---

## Default-off implementation slice

AUT-534 implements this slice and nothing wider. Suggested issue text:

**Title:** AUT-534: default-off TecDoc Pegasus 3.0 parts adapter

**Behavior:**

- Add `TecdocPegasusPartsCatalogProvider` for adapter id `tecdoc-pegasus-3-0-parts`. Register it beside the sandbox composite. Do not route it through the `aftermarket` substring.
- Call TecDoc only when `CATALOG_TECDOC_PARTS_ENABLED=true` and the secret is complete. Tests leave the flag unset and bind a fake transport that returns rows from `docs/internal/02-Feature-Specs/Vehicles/catalog-live-provider.fixtures.json`.
- Cover fixture ids `hit`, `no-match`, `no-link`, `ambiguous-articles`, `ambiguous-links`, `ambiguous-conditional`, `ambiguous-eans`, `wrong-vehicle-key`, `wrong-vehicle-key-type`, `auth-failure`, `rate-limit`, `too-many-results`, `timeout`, `timeout-transport`, `invalid-request`, and `sandbox-parts`.
- Change `SandboxAftermarketPartsCatalogProvider` to the `sandbox-parts` fixture shape. Update `catalog-external.e2e-spec.ts` so aftermarket `sourceSystem` is `sandbox-tecdoc` and the name starts with `Synthetic `. That replaces the current `tecdoc` expectation; it does not delete the assertion.
- Leave `SandboxAftermarketLaborCatalogProvider` on `haynes`. Do not add a TecDoc labour method.
- Map `unitPrice` null through the search DTO. Keep the add-to-order rejection for a missing price.
- Write `specs.tecdoc` only on JIT of a unique live hit.
- Add blocker `SYNTHETIC_CATALOG` on the existing `422` `ESTIMATE_CUSTOMER_SEND_BLOCKED`, allowlist that code, forward `blockers`, and test that a `sandbox-tecdoc` line cannot be sent.

**Still required before any environment sets the flag:** a TecDoc Web Service licence, provider id, API key, static address allowlist, `articleCountry`, `lang`, and a written note that prices are either absent or still unmapped. The flag ships default off. No deploy and no provider call are part of AUT-534’s definition of done.

---

## Testing Plan

### Backend E2E

The follow-up loads the fixture file. This spec PR has no product test to run.

- [ ] Happy path: fixture `hit` maps to the `acpHit` object, `unitPrice` null, `standardAw` absent, `synthetic` false.
- [ ] No match, ambiguous, wrong vehicle key, auth failure, rate limit, too-many-results, and timeout match the fixture `acpOutcome`.
- [ ] Sandbox search returns `sandbox-parts` and fails the live fitment predicate.
- [ ] Flag off: adapter id `tecdoc-pegasus-3-0-parts` performs no HTTP.

### Frontend

- [ ] After AUT-534, the search result shows `Synthetic` for the sandbox hit and shows an ambiguous live hit as ambiguous. No browser check belongs to this docs PR.

---

## Unknown semantics

These are unmapped on purpose.

| Topic | What the public text says | What ACP does |
|---|---|---|
| Price integer scale | Integer price; retail price “with 2 decimal spaces” | Null `unitPrice` and `costPriceEst` |
| Which price type (KT 074) is a selling price | Key-table reference only | Prices flag false |
| Conditional attribute matching | `attrIsConditional` is a flag; some attribute types are “Others tbd” | Ambiguous hit |
| Several EANs | A sequence of EAN numbers | Ambiguous, `ean` null |
| `getVersionInfo` | Named as the replacement for `getPegasusVersionInfo2`, missing from the function index | Call `getPegasusVersionInfo2` |
| Requests per minute | Not published | One attempt; HTTP 429 is rate limit |
| Hostname region | Status page lists three AWS regions; the endpoint has no region field | Call the pinned host only |
| `statusText` wording | “Error text if status > 200” | Ignore the text |
| TecRMI operation code and AW unit | Product page names labour times; no function schema on the TecDoc info site | No labour call |

---

## Open Questions

None for this spec. Unmapped provider fields stay null. They are not follow-up guesses.

---

## References

- Fixtures: [catalog-live-provider.fixtures.json](./catalog-live-provider.fixtures.json)
- ADR-0021: [2026-08-28-vehicle-intelligence-catalog-providers.md](../../01-ADR/2026-08-28-vehicle-intelligence-catalog-providers.md)
- Catalog spec: [2026-08-28-vehicle-intelligence-and-parts-catalog.md](../Vehicle/2026-08-28-vehicle-intelligence-and-parts-catalog.md)
- TecAlliance catalogue & eCommerce, read 2026-10-16: https://www.tecalliance.net/products?solution=catalogue-ecommerce
- TecDoc Web Service info, WEB SERVICE 3.0: https://webservice.tecalliance.services/pegasus-3-0/info/
- Entry points: `apps/core-api/src/catalog/catalog.module.ts`, `providers/catalog-provider.types.ts`, `providers/parts-catalog.provider.ts`, `providers/labor-catalog.provider.ts`, `providers/sandbox/sandbox-aftermarket-parts.provider.ts`
- Existing test to update in AUT-534: `apps/core-api/test/catalog-external.e2e-spec.ts`

---

## Linear Tracking

| Field | Value |
|---|---|
| Project | [Vehicle Intelligence & Parts Catalog](https://linear.app/auto-core-platform/project/vehicle-intelligence-and-parts-catalog-bb669a797c7b) |
| Milestone | M4 Wholesaler B2B (later) |
| Issues | [AUT-525](https://linear.app/auto-core-platform/issue/AUT-525) spec. [AUT-534](https://linear.app/auto-core-platform/issue/AUT-534) default-off implementation, blocked by AUT-525. Parent [AUT-506](https://linear.app/auto-core-platform/issue/AUT-506). |
