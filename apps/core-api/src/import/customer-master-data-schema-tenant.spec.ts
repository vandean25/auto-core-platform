import {
  callTenantIsolatedQuery,
  MASTER_DATA_SCHEMA_TENANT_ID,
  runMasterDataSchemaWithTenant,
} from './customer-master-data-schema.spec.support.js';

describe('customer master data schema (tenant isolation)', () => {
  it('scopes LaborPriceGroup queries by tenant_id', async () => {
    const query = jest.fn().mockResolvedValue([]);

    await runMasterDataSchemaWithTenant(() =>
      callTenantIsolatedQuery('LaborPriceGroup', 'findMany', { where: {} }, query),
    );

    expect(query).toHaveBeenCalledWith({
      where: { tenant_id: MASTER_DATA_SCHEMA_TENANT_ID },
    });
  });
});
