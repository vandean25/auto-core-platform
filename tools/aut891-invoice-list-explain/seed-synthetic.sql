-- Synthetic AUT-891 invoice explain fixture (disposable DB only). No production/QA data.
\set tenant_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\set tenant_b 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set rows_per_tenant 30000

INSERT INTO tenants (id, name, slug, created_at, updated_at, is_active, is_landing_demo_tenant, api_rate_limit_per_minute, default_locale, format_locale)
SELECT t.id, 'AUT891 explain ' || t.slug, 'aut891-explain-' || t.slug, NOW(), NOW(), true, false, 60, 'de', 'de-AT'
FROM (VALUES (:'tenant_a'::text, 'a'), (:'tenant_b'::text, 'b')) AS t(id, slug);

INSERT INTO customers (id, tenant_id, first_name, last_name, "createdAt", "updatedAt")
SELECT 'c0000000-0000-4000-8000-' || lpad(n::text, 12, '0') || '', t.id, 'Vorname' || n, 'Nachname' || (n % 500), NOW(), NOW()
FROM (VALUES (:'tenant_a'::text, 1), (:'tenant_b'::text, 2)) AS t(id, n);

-- ~5% drafts without a number; dates spread over two years, many invoices per day (ties on date).
INSERT INTO invoices (id, tenant_id, customer_id, invoice_number, status, date, due_date, total_net, total_tax, total_gross, "createdAt", "updatedAt")
SELECT gen_random_uuid(), t.id, 'c0000000-0000-4000-8000-' || lpad(t.n::text, 12, '0'),
       CASE WHEN g % 20 = 0 THEN NULL ELSE 'RE-2026-' || lpad(g::text, 6, '0') END,
       CASE WHEN g % 20 = 0 THEN 'DRAFT'::"InvoiceStatus" ELSE 'FINALIZED'::"InvoiceStatus" END,
       timestamp '2025-01-01' + ((g / 40) || ' days')::interval, timestamp '2025-02-01' + ((g / 40) || ' days')::interval,
       100, 20, 120, NOW(), NOW()
FROM (VALUES (:'tenant_a'::text, 1), (:'tenant_b'::text, 2)) AS t(id, n), generate_series(1, :rows_per_tenant) AS g;

ANALYZE invoices;
