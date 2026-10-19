import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TenantContextStorage } from '../common/services/tenant-context.storage.js';
import { applyTenantIsolation } from '../prisma/tenant-isolation.extension.js';

const TENANT_ID = 'tenant-test-master-data-schema';

function runWithTenant<T>(fn: () => T) {
  return TenantContextStorage.run(() => {
    TenantContextStorage.setUser({
      userId: 'user-1',
      email: 'test@example.com',
      tenantId: TENANT_ID,
      role: 'ADMIN',
    });
    return fn();
  });
}

function call(
  model: string,
  operation: string,
  args: Record<string, unknown> | undefined,
  queryFn: jest.Mock,
) {
  return applyTenantIsolation.call({}, {}, model, operation, args, queryFn);
}

describe('customer master data schema (Prisma)', () => {
  const schema = readFileSync(
    join(process.cwd(), 'prisma', 'schema.prisma'),
    'utf8',
  );

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
      'labor_price_group        LaborPriceGroup? @relation(fields: [tenant_id, labor_price_group_id], references: [tenant_id, id]',
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

  it('documents migration master-data fields on detail response DTOs', () => {
    expect(
      readFileSync(
        join(
          process.cwd(),
          'src',
          'customer',
          'dto',
          'customer-detail-api-response.dto.ts',
        ),
        'utf8',
      ),
    ).toContain('block_level');
    expect(
      readFileSync(
        join(
          process.cwd(),
          'src',
          'workshop',
          'dto',
          'workshop-api-response.dto.ts',
        ),
        'utf8',
      ),
    ).toContain('bill_to_customer_id');
  });

  it('scopes LaborPriceGroup queries by tenant_id', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await runWithTenant(() =>
      call('LaborPriceGroup', 'findMany', { where: {} }, query),
    );

    expect(query).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID },
    });
  });
});
