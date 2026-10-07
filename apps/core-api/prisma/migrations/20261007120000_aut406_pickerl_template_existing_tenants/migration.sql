INSERT INTO "inspection_templates" (
  "id", "tenant_id", "code", "title", "version", "is_active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  tenant."id",
  'PICKERL_57A_PREP',
  '§57a Vorbereitung — editierbare Start-Checkliste, keine Rechtsliste',
  1,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "tenants" AS tenant
ON CONFLICT ("tenant_id", "code", "version") DO NOTHING;

INSERT INTO "inspection_template_items" (
  "id", "tenant_id", "inspection_template_id", "code", "label",
  "response_type", "unit", "sort_order", "is_required", "is_active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  template."tenant_id",
  template."id",
  item."code",
  item."label",
  'PASS_FAIL'::"InspectionTemplateItemResponseType",
  NULL,
  item."sort_order",
  FALSE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "inspection_templates" AS template
CROSS JOIN (VALUES
  ('LIGHTS', 'Beleuchtung', 1),
  ('BRAKES', 'Bremsen', 2),
  ('TYRES', 'Reifen', 3),
  ('WIPERS_WASHER', 'Scheibenwischer und Waschanlage', 4),
  ('HORN', 'Hupe', 5),
  ('SEAT_BELTS', 'Sicherheitsgurte', 6),
  ('EXHAUST_LEAKS', 'Abgasanlage und Undichtigkeiten', 7),
  ('WARNING_TRIANGLE', 'Warndreieck', 8),
  ('FIRST_AID_KIT', 'Erste-Hilfe-Kasten', 9),
  ('SAFETY_VEST', 'Warnweste', 10),
  ('VIN_READABLE', 'Fahrzeug-Identifizierungsnummer lesbar', 11),
  ('PLATE_READABLE', 'Kennzeichen lesbar', 12)
) AS item("code", "label", "sort_order")
WHERE template."code" = 'PICKERL_57A_PREP'
  AND template."version" = 1
ON CONFLICT ("tenant_id", "inspection_template_id", "code") DO NOTHING;
