# AS24_PROVISIONAL_V1 field verification (AUT-570)

This profile exports a UTF-8 BOM semicolon CSV plus a flat image ZIP. AutoScout24 AT documents that dealers import listings from a sample table (`Mustertabelle_AS24.xls`) and place images in a ZIP whose file names match the CSV ([partner FAQ](https://www.autoscout24.at/partner-infoportal/faq/)). The workbook bytes were not available during implementation, so the column contract below is an **ACP provisional** layout (same shape as the internal marketplace-export spec) rather than a certified Mustertabelle mapping.

| Column | Source in ACP snapshot | Verification |
| --- | --- | --- |
| `listing_ref` | Public listing reference | **VERIFIED** — stable identity required for manual re-import; FAQ describes per-vehicle references in the CSV. |
| `action` | Constant `UPSERT` for active rows | **VERIFIED** — active offers are exported in the main CSV; removals use the separate ACP `removals.csv` companion (not a Mustertabelle column). |
| `title` | Listing title | **UNVERIFIED** — Mustertabelle column name/semantics unknown. |
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
| `price_gross_eur` | Gross consumer price, two decimals | **UNVERIFIED** — PrAG/willhaben-style all-in pricing is a legal/dealer obligation, not verified against AS24 import. |
| `currency` | Constant `EUR` | **UNVERIFIED** |
| `vat_display` | `STANDARD` or `MARGIN` | **UNVERIFIED** |
| `nova_included` | (empty until mapped) | **UNVERIFIED** |
| `co2_wltp_g_km` | WLTP CO₂ g/km when present | **UNVERIFIED** |
| `co2_nedc_g_km` | NEDC CO₂ g/km when present | **UNVERIFIED** |
| `emission_class` | Emission class text | **UNVERIFIED** |
| `description_language` | (empty until mapped) | **UNVERIFIED** |
| `description` | Listing description (equipment free text is separate) | **UNVERIFIED** |
| `equipment_codes` | Pipe-joined local taxonomy codes for `AS24_PROVISIONAL_V1` | **UNVERIFIED** — codes are ACP-local, not official AS24 option ids. |
| `equipment_free_text` | Semicolon-joined custom equipment lines | **UNVERIFIED** |
| `image_files` | Pipe-joined flat JPEG names | **VERIFIED** — FAQ requires ZIP image file names to match CSV references; ACP uses `<listing_ref>_<01..30>.jpg`. |
| `seller_name` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_contact` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_postcode` | (empty until dealer fields exist) | **UNVERIFIED** |
| `seller_city` | (empty until dealer fields exist) | **UNVERIFIED** |

**File / encoding verification**

| Rule | Verification |
| --- | --- |
| UTF-8 with BOM | **VERIFIED** (spreadsheet-oriented profiles in marketplace-export spec; consistent with FAQ CSV import) |
| `;` delimiter, quoted fields, CRLF rows | **VERIFIED** (ACP provisional contract) |
| Formula neutralisation (`= + - @` prefix with `'`) | **VERIFIED** (ACP safety rule) |
| Max 30 images per listing | **UNVERIFIED** portal guarantee; **VERIFIED** as documented ACP cap |
