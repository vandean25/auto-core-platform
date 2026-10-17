INSERT INTO "inspection_templates" (
  "id", "tenant_id", "code", "title", "version", "is_active", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  tenant."id",
  'ANNAHME_CHECK',
  'Annahme-Check',
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
  ('KEYS_COMPLETE', 'Schlüssel vollständig', 1),
  ('SERVICE_BOOK', 'Serviceheft / Bordmappe', 2),
  ('REGISTRATION_DOC', 'Zulassungsbescheinigung', 3),
  ('WARNING_TRIANGLE', 'Warndreieck', 4),
  ('FIRST_AID_KIT', 'Verbandskasten', 5),
  ('SAFETY_VEST', 'Warnweste', 6),
  ('FLOOR_MATS', 'Fußmatten dokumentiert', 7),
  ('PERSONAL_ITEMS', 'Persönliche Gegenstände dokumentiert', 8)
) AS item("code", "label", "sort_order")
WHERE template."code" = 'ANNAHME_CHECK'
  AND template."version" = 1
ON CONFLICT ("tenant_id", "inspection_template_id", "code") DO NOTHING;
