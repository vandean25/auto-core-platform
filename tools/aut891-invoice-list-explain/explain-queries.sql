-- Prisma-shaped invoice list queries (hand-written approximation, tenant A, page size 50 + 1).
\set tenant_a 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
\echo '== 1 number ASC, first page'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' ORDER BY invoice_number ASC NULLS LAST, id ASC LIMIT 51;
\echo '== 2 number ASC, continuation at RE-2026-015000'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' AND (invoice_number > 'RE-2026-015000' OR (invoice_number = 'RE-2026-015000' AND id > '00000000-0000-0000-0000-000000000000') OR invoice_number IS NULL) ORDER BY invoice_number ASC NULLS LAST, id ASC LIMIT 51;
\echo '== 3 number DESC NULLS LAST, first page'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' ORDER BY invoice_number DESC NULLS LAST, id DESC LIMIT 51;
\echo '== 4 date DESC, first page (the default)'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' ORDER BY date DESC, id DESC LIMIT 51;
\echo '== 5 date DESC, continuation at 2026-01-01'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' AND (date < '2026-01-01' OR (date = '2026-01-01' AND id < 'ffffffff-ffff-ffff-ffff-ffffffffffff')) ORDER BY date DESC, id DESC LIMIT 51;
\echo '== 6 search on the number (contains, case-insensitive), date DESC'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' AND invoice_number ILIKE '%015000%' ORDER BY date DESC, id DESC LIMIT 51;
\echo '== 7 search without any match, date DESC'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE tenant_id = :'tenant_a' AND invoice_number ILIKE '%zzzz%' ORDER BY date DESC, id DESC LIMIT 51;
\echo '== 8 capped count probe (no search)'
EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM invoices WHERE tenant_id = :'tenant_a' LIMIT 1001;
\echo '== 9 combined search (number OR customer name OR status), no match, date DESC'
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices i WHERE i.tenant_id = :'tenant_a' AND (i.invoice_number ILIKE '%zzzz%' OR EXISTS (SELECT 1 FROM customers c WHERE c.id = i.customer_id AND c.tenant_id = :'tenant_a' AND (c.first_name ILIKE '%zzzz%' OR c.last_name ILIKE '%zzzz%' OR c.company_name ILIKE '%zzzz%')) OR i.status IN ('PAID')) ORDER BY i.date DESC, i.id DESC LIMIT 51;
