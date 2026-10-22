import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('legacy migration schema M2 (Prisma enums and models)', () => {
  it('defines CostBearer with split-invoicing values', () => {
    const block = schema.match(/enum CostBearer \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(block).toContain('CUSTOMER');
    expect(block).toContain('WARRANTY');
    expect(block).toContain('GOODWILL');
    expect(block).toContain('INTERNAL');
  });

  it('defines LegacyDocument with tenant-scoped fields and composite FKs', () => {
    const block =
      schema.match(/model LegacyDocument \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(block).toContain('tenant_id');
    expect(block).toContain('source_system');
    expect(block).toContain('external_id');
    expect(block).toContain('doc_type');
    expect(block).toContain('LegacyDocumentType');
    expect(block).toContain('origin');
    expect(block).toContain('payload_json');
    expect(block).toContain('payload_sha256');
    expect(block).toContain('retain_until');
    expect(block).toContain('legal_hold');
    expect(block).toContain('import_job_id');
    expect(block).toContain('migration_run_id');
    expect(block).toContain('superseded_by_run_id');
    expect(block).toContain(
      '@relation(fields: [tenant_id, import_job_id], references: [tenant_id, id]',
    );
    expect(block).toContain('@@unique([tenant_id, id])');
    expect(block).toContain('@@index([tenant_id, source_system, doc_type, external_id])');
    expect(block).toContain('@@index([tenant_id, migration_run_id, external_id])');
    expect(schema).toContain(
      'OPEN_ITEM rows require `migration_run_id` (`legacy_documents_open_item_requires_migration_run_check`',
    );
  });

  it('defines LegacyDocumentLine with composite tenant FK to LegacyDocument', () => {
    const block =
      schema.match(/model LegacyDocumentLine \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(block).toContain('line_no');
    expect(block).toContain('LegacyDocumentLineType');
    expect(block).toContain('cost_bearer');
    expect(block).toContain('CostBearer?');
    expect(block).toContain(
      '@relation(fields: [tenant_id, legacy_document_id], references: [tenant_id, id]',
    );
    expect(block).toContain('@@id([tenant_id, legacy_document_id, line_no])');
  });

  it('defines MigrationRun with status enum and optional ImportJob link', () => {
    const runBlock =
      schema.match(/model MigrationRun \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(runBlock).toContain('MigrationRunStatus');
    expect(runBlock).toContain('manifest_json');
    expect(runBlock).toContain('manifest_sha256');
    expect(runBlock).toContain('cutover_date');
    expect(runBlock).toContain('@@unique([tenant_id, id])');

    const jobBlock =
      schema.match(/model ImportJob \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(jobBlock).toContain('migration_run_id');
    expect(jobBlock).toContain('MigrationRun?');
  });
});
