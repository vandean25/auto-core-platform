import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('AuditLog Prisma schema contract (AUT-109)', () => {
  const schema = readFileSync(join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8');

  it('defines AuditLog model with tenant scope, context fields, snapshots, and indexes', () => {
    expect(schema).toContain('enum AuditLogAction {');
    expect(schema).toContain('enum AuditActorType {');

    const auditLogBlock =
      schema.match(/model\s+AuditLog\s*\{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(auditLogBlock).toContain('model AuditLog {');

    expect(auditLogBlock).toMatch(/^\s+tenant_id\s+String/m);
    expect(auditLogBlock).toMatch(/^\s+entity_type\s+String/m);
    expect(auditLogBlock).toMatch(/^\s+entity_id\s+String/m);
    expect(auditLogBlock).toMatch(/^\s+action\s+AuditLogAction/m);
    expect(auditLogBlock).toMatch(/^\s+actor_type\s+AuditActorType/m);
    expect(auditLogBlock).toMatch(/^\s+before\s+Json\?/m);
    expect(auditLogBlock).toMatch(/^\s+after\s+Json\?/m);
    expect(auditLogBlock).toMatch(/^\s+diff\s+Json\?/m);
    expect(auditLogBlock).toMatch(/^\s+changed_fields\s+Json\?/m);
    expect(auditLogBlock).toMatch(/^\s+redacted_fields\s+Json\?/m);
    expect(auditLogBlock).toMatch(/occurred_at\s+DateTime\s+@default\(now\(\)\)/);

    expect(auditLogBlock).toContain('@@index([tenant_id, occurred_at])');
    expect(auditLogBlock).toContain(
      '@@index([tenant_id, entity_type, entity_id, occurred_at])',
    );
    expect(auditLogBlock).toContain('@@index([request_id])');
    expect(auditLogBlock).toContain('@@map("audit_logs")');
  });
});
