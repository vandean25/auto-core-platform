# AS24_PROVISIONAL_V1 field verification (AUT-570)

AutoScout24 AT’s public [partner FAQ](https://www.autoscout24.at/partner-infoportal/faq/) says dealers fill in `Mustertabelle_AS24.xls`, save it from Excel as **CSV (Trennzeichen getrennt)**, and supply images in a **ZIP whose file names match the CSV exactly**. The workbook was not available during implementation, so the column list below is an **ACP provisional** contract (aligned with the internal marketplace-export spec), not a certified Mustertabelle mapping.

**FAQ-backed (VERIFIED against that source only)**

| What | Verification |
| --- | --- |
| Listings are delivered as a delimiter-separated CSV exported from the Excel sample table | **VERIFIED** — FAQ “CSV (Trennzeichen getrennt)” from `Mustertabelle_AS24.xls`. Exact delimiter, encoding, quoting, and line endings are **not** specified (German Excel often uses locale separators and Windows-1252). |
| Images are bundled in a ZIP; file names in the ZIP must match the CSV | **VERIFIED** — FAQ wording. Which CSV column holds the references and the required name pattern are **UNVERIFIED** until the workbook is pinned. |

**ACP contract (UNVERIFIED against Mustertabelle / FAQ unless noted)**

| Column | Source in ACP snapshot | Verification |
| --- | --- | --- |
| `listing_ref` | Public listing reference | **UNVERIFIED** — not named in the FAQ; ACP uses the stable public ref as provisional identity. |
| `action` | Constant `UPSERT` on download | **UNVERIFIED** — not a Mustertabelle/FAQ column. Only **ACTIVE** channels are included: `downloadListingPackage` rejects `desired_state !== ACTIVE`, so inactive or `REMOVAL_REQUIRED` listings never appear in this CSV. This slice does **not** write a portal removal file or `removals.csv`; dealers handle delisting outside this download. |
| `title` | Listing title | **UNVERIFIED** |
| `make` | Vehicle make | **UNVERIFIED** |
| `model` | Vehicle model | **UNVERIFIED** |
| `model_year` | Vehicle model year | **UNVERIFIED** |
| `first_registration` | ISO `YYYY-MM-DD` first registration | **UNVERIFIED** |
| `mileage_km` | Integer km | **UNVERIFIED** |
| `fuel` | Free-text fuel label from stock | **UNVERIFIED** |
| `power_kw` | Integer kW | **UNVERIFIED** |
| `body_type` | (empty until mapped) | **UNVERIFIED** |
| `transmission` | (empty until mapped) | **UNVERIFIED** |
| `doors` | (empty until mapped) | **UNVERIFIED** |
| `seats` | (empty until mapped) | **UNVERIFIED** |
| `color` | Exterior colour text | **UNVERIFIED** |
| `damage_status` | Derived from `damage_free` assertion (`NONE` / `UNKNOWN`) | **UNVERIFIED** |
| `roadworthy` | (empty until mapped) | **UNVERIFIED** |
| `price_gross_eur` | Gross consumer price, two decimals | **UNVERIFIED** |
| `currency` | Constant `EUR` | **UNVERIFIED** |
| `vat_display` | `STANDARD` or `MARGIN` | **UNVERIFIED** |
| `nova_included` | (empty until mapped) | **UNVERIFIED** |
| `co2_wltp_g_km` | WLTP CO₂ g/km when present (`0` exported when known) | **UNVERIFIED** |
| `co2_nedc_g_km` | NEDC CO₂ g/km when present (`0` exported when known) | **UNVERIFIED** |
| `emission_class` | Emission class text | **UNVERIFIED** |
| `description_language` | (empty until mapped) | **UNVERIFIED** |
| `description` | Listing description (equipment free text is separate) | **UNVERIFIED** |
| `equipment_codes` | Pipe-joined local taxonomy codes for `AS24_PROVISIONAL_V1` | **UNVERIFIED** — ACP-local codes, not official AS24 option ids. |
| `equipment_free_text` | Semicolon-joined custom equipment lines | **UNVERIFIED** |
| `image_files` | Pipe-joined flat JPEG names in the ZIP | **Partially VERIFIED** — FAQ requires ZIP names to match the CSV; **UNVERIFIED** which column and format Mustertabelle uses. ACP maps this column to `<listing_ref>_<01..30>.jpg` (30-image cap is ACP-only, not FAQ). |
| `seller_name` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_contact` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_postcode` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_city` | (empty until dealer fields exist) | **UNVERIFIED** |

**File / encoding (ACP provisional export rules — UNVERIFIED as AS24 import requirements)**

| Rule | Verification |
| --- | --- |
| UTF-8 with BOM | **UNVERIFIED** — FAQ does not specify encoding; ACP choice for spreadsheet tools. |
| `;` delimiter, every cell double-quoted, CRLF rows | **UNVERIFIED** — FAQ only mentions delimiter-separated CSV from Excel; quoting and CRLF are ACP pinning. |
| Formula neutralisation (`= + - @` prefix with `'`) | **UNVERIFIED** — ACP safety rule, not stated in the FAQ. |
| Max 30 images per listing | **UNVERIFIED** — documented ACP cap, not a verified AS24 limit. |
