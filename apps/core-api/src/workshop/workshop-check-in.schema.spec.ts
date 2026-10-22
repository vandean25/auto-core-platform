import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('WorkshopCheckIn Prisma schema', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

  it('defines tenant-scoped WorkshopCheckIn with composite order FK', () => {
    const block =
      schema.match(/model WorkshopCheckIn \{[\s\S]*?\n\}/m)?.[0] ?? '';

    expect(block).toContain('tenant_id');
    expect(block).toContain('workshop_order_id');
    expect(block).toContain('@@unique([tenant_id, id])');
    expect(block).toContain('@@unique([tenant_id, workshop_order_id])');
    expect(block).toContain('@@index([tenant_id])');
    expect(block).toContain(
      'workshop_order          WorkshopOrder         @relation(fields: [tenant_id, workshop_order_id], references: [tenant_id, id], onDelete: Restrict, onUpdate: Cascade)',
    );
    expect(schema).toContain('enum WorkshopCheckInStatus');
    expect(block).not.toMatch(/model WorkshopOrder/);
  });

  it('extends WorkshopMedia with purpose and nullable check_in_id', () => {
    const block =
      schema.match(/model WorkshopMedia \{[\s\S]*?\n\}/m)?.[0] ?? '';

    expect(block).toContain('purpose                 WorkshopMediaPurpose     @default(GENERAL)');
    expect(block).toContain('check_in_id             String?');
    expect(block).toContain(
      'check_in                WorkshopCheckIn?         @relation(fields: [tenant_id, check_in_id], references: [tenant_id, id], onDelete: Restrict, onUpdate: Cascade)',
    );
    expect(block).toContain('@@index([tenant_id, check_in_id]');
    expect(schema).toContain('enum WorkshopMediaPurpose');
  });
});
