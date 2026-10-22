import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const schema = readFileSync(
  join(process.cwd(), 'prisma', 'schema.prisma'),
  'utf8',
);

describe('customer master data schema (Prisma enum and models)', () => {
  it('extends ImportEntityType with migration master-data values', () => {
    const block =
      schema.match(/enum ImportEntityType \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(block).toContain('LABOR_PRICE_GROUP');
    expect(block).toContain('PART');
    expect(block).toContain('CUSTOMER');
    expect(block).toContain('LABOR_OPERATION');
  });

  it('defines tenant-safe customer bill-to and labor price group relations', () => {
    const customerBlock =
      schema.match(/model Customer \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(customerBlock).toContain('default_bill_to_customer_id');
    expect(customerBlock).toContain(
      '@relation("CustomerDefaultBillTo", fields: [tenant_id, default_bill_to_customer_id], references: [tenant_id, id]',
    );
    expect(customerBlock).toContain('labor_price_group_id');
    expect(customerBlock).toContain(
      'labor_price_group              LaborPriceGroup?    @relation(fields: [tenant_id, labor_price_group_id], references: [tenant_id, id], onDelete: SetNull)',
    );
  });

  it('defines workshop order bill-to with composite tenant FK', () => {
    const orderBlock =
      schema.match(/model WorkshopOrder \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(orderBlock).toContain('bill_to_customer_id');
    expect(orderBlock).toContain(
      '@relation("WorkshopOrderBillTo", fields: [tenant_id, bill_to_customer_id], references: [tenant_id, id]',
    );
  });

  it('defines LaborPriceGroup with tenant-scoped uniqueness', () => {
    const groupBlock =
      schema.match(/model LaborPriceGroup \{[\s\S]*?\n\}/m)?.[0] ?? '';
    expect(groupBlock).toContain('@@unique([tenant_id, code])');
    expect(groupBlock).toContain('@@unique([tenant_id, id])');
    expect(groupBlock).toContain('@@index([tenant_id])');
  });
});
