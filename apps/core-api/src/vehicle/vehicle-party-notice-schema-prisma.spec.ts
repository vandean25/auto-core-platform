import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

function block(kind: 'model' | 'enum', name: string): string {
  return (
    schema.match(new RegExp(`${kind} ${name} \\{[\\s\\S]*?\\n\\}`, 'm'))?.[0] ??
    ''
  );
}

function enumValues(name: string): string[] {
  return block('enum', name)
    .split('\n')
    .slice(1, -1)
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('vehicle party and notice schema M3', () => {
  it('defines the party role, notice type/status and record source enums', () => {
    expect(enumValues('VehiclePartyRole')).toEqual([
      'OWNER',
      'DRIVER',
      'USER',
      'BILL_TO',
      'LEASING',
      'INSURANCE',
      'WARRANTY_PROVIDER',
      'SERVICE_CONTRACT',
      'PREVIOUS_OWNER',
    ]);
    expect(enumValues('VehicleNoticeType')).toEqual([
      'CAMPAIGN',
      'RECALL',
      'REMARK',
      'WARNING',
      'SERVICE_DUE',
    ]);
    expect(enumValues('VehicleNoticeStatus')).toEqual([
      'OPEN',
      'DONE',
      'DISMISSED',
    ]);
    expect(enumValues('VehicleRecordSource')).toEqual([
      'MANUAL',
      'LEGACY_IMPORT',
    ]);
  });

  it('adds LEGACY_IMPORT to VehicleInspectionRecordSource without touching the old values', () => {
    expect(enumValues('VehicleInspectionRecordSource')).toEqual([
      'MANUAL',
      'EBV_IMPORTED',
      'LEGACY_IMPORT',
    ]);
  });

  it('defines VehicleParty with composite tenant FKs and the SQL-only constructs documented', () => {
    const party = block('model', 'VehicleParty');
    for (const field of [
      'id ',
      'tenant_id',
      'vehicle_id',
      'customer_id',
      'role ',
      'valid_from',
      'valid_to',
      'source ',
      'notes',
      'createdAt',
      'updatedAt',
    ]) {
      expect(party).toContain(field);
    }
    expect(party).toContain(
      '@relation(fields: [tenant_id, vehicle_id], references: [tenant_id, id]',
    );
    expect(party).toContain(
      '@relation(fields: [tenant_id, customer_id], references: [tenant_id, id]',
    );
    expect(party).toContain('@@unique([tenant_id, id])');
    expect(party).toContain('@@index([tenant_id, vehicle_id])');
    expect(party).toContain('@@index([tenant_id, customer_id])');
    expect(party).toContain('@@map("vehicle_parties")');
    expect(schema).toContain('vehicle_parties_valid_interval_check');
    expect(schema).toContain('vehicle_parties_one_active_singleton_role_key');
  });

  it('defines VehicleNotice with every column the notices work needs', () => {
    const notice = block('model', 'VehicleNotice');
    for (const field of [
      'tenant_id',
      'vehicle_id',
      'type ',
      'title',
      'body',
      'status ',
      'due_date',
      'due_mileage',
      'external_ref',
      'source ',
      'created_by_user_id',
      'resolved_at',
      'resolved_by_user_id',
      'resolved_workshop_order_id',
    ]) {
      expect(notice).toContain(field);
    }
    expect(notice).toContain(
      '@relation(fields: [tenant_id, vehicle_id], references: [tenant_id, id]',
    );
    expect(notice).toContain(
      '@relation(fields: [tenant_id, resolved_workshop_order_id], references: [tenant_id, id]',
    );
    expect(notice).toContain('@@unique([tenant_id, id])');
    expect(notice).toContain('@@index([tenant_id, vehicle_id, status])');
    expect(notice).toContain('@@index([tenant_id, status, due_date])');
    expect(notice).toContain('@@map("vehicle_notices")');
    expect(schema).toContain('vehicle_notices_external_ref_key');
  });
});
