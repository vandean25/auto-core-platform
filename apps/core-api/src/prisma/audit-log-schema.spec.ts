import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AuditLog Prisma schema contract (AUT-109)', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('defines AuditLog model with tenant scope, context fields, snapshots, and indexes', () => {
    expect(schema).toContain('enum AuditLogAction {');
    expect(schema).toContain('enum AuditActorType {');
    expect(schema).toContain('model AuditLog {');
    expect(schema).toMatch(/tenant_id\s+String/);
    expect(schema).toMatch(/entity_type\s+String/);
    expect(schema).toMatch(/entity_id\s+String/);
    expect(schema).toMatch(/action\s+AuditLogAction/);
    expect(schema).toMatch(/actor_type\s+AuditActorType/);
    expect(schema).toMatch(/before\s+Json\?/);
    expect(schema).toMatch(/after\s+Json\?/);
    expect(schema).toMatch(/diff\s+Json\?/);
    expect(schema).toMatch(/changed_fields\s+Json\?/);
    expect(schema).toMatch(/redacted_fields\s+Json\?/);
    expect(schema).toMatch(/occurred_at\s+DateTime\s+@default\(now\(\)\)/);
    expect(schema).toContain('@@index([tenant_id, occurred_at])');
    expect(schema).toContain(
      '@@index([tenant_id, entity_type, entity_id, occurred_at])',
    );
    expect(schema).toContain('@@index([request_id])');
    expect(schema).toContain('@@map("audit_logs")');
  });
});
