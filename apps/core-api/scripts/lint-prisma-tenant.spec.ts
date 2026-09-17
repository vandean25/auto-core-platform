import { lintPrismaTenantSchema } from './lint-prisma-tenant.js';
import {
  lintPrismaSiteScopeQueries,
  lintPrismaSiteScopeSchema,
} from './lint-prisma-site-scope.js';

describe('lintPrismaTenantSchema', () => {
  it('fails when a tenant model uses field-level @unique', () => {
    const badSchema = `
      model Customer {
        id String @id
        tenant_id String
        tenant Tenant @relation(fields: [tenant_id], references: [id])
        email String? @unique

        @@index([tenant_id])
      }
    `;

    expect(() => lintPrismaTenantSchema(badSchema)).toThrow(
      /field-level @unique/,
    );
  });

  it('fails when a tenant-scoped @@unique block does not start with tenant_id', () => {
    const badSchema = `
      model CatalogItem {
        id String @id
        tenant_id String
        tenant Tenant @relation(fields: [tenant_id], references: [id])
        sku String

        @@unique([sku, tenant_id])
      }
    `;

    expect(() => lintPrismaTenantSchema(badSchema)).toThrow(
      /does not start with 'tenant_id'/,
    );
  });

  it('passes when tenant-scoped uniqueness is composite and prefixed with tenant_id', () => {
    const goodSchema = `
      model CatalogItem {
        id String @id
        tenant_id String
        tenant Tenant @relation(fields: [tenant_id], references: [id])
        sku String

        @@index([tenant_id])
        @@unique([tenant_id, sku])
      }
    `;

    expect(() => lintPrismaTenantSchema(goodSchema)).not.toThrow();
  });
});

describe('lintPrismaSiteScopeSchema', () => {
  it('fails when a site-owned model does not declare site_id', () => {
    const badSchema = `
      model WorkshopOrder {
        id String @id
        tenant_id String
      }
    `;

    expect(() => lintPrismaSiteScopeSchema(badSchema)).toThrow(
      /WorkshopOrder.*site_id/,
    );
  });

  it('passes tenant-wide models and site-owned models with site_id', () => {
    const goodSchema = `
      model Customer {
        id String @id
        tenant_id String
      }

      model WorkshopOrder {
        id String @id
        tenant_id String
        site_id String
      }
    `;

    expect(() => lintPrismaSiteScopeSchema(goodSchema)).not.toThrow();
  });

  it('fails when a stock transfer omits either site dimension', () => {
    const badSchema = `
      model StockTransfer {
        id String @id
        tenant_id String
        from_site_id String
      }
    `;

    expect(() => lintPrismaSiteScopeSchema(badSchema)).toThrow(
      /StockTransfer.*to_site_id/,
    );
  });

  it('fails tenant-only operational queries', () => {
    expect(() =>
      lintPrismaSiteScopeQueries([
        {
          path: 'workshop-order.service.ts',
          content: `prisma.workshopOrder.findMany({ where: { tenant_id: tenantId } })`,
        },
      ]),
    ).toThrow(/workshopOrder\.findMany.*active site/);
  });

  it('does not accept a file-level site context call as query scope', () => {
    expect(() =>
      lintPrismaSiteScopeQueries([
        {
          path: 'workshop-order.service.ts',
          content: `this.siteContext.getSiteId();\nprisma.workshopOrder.findMany({ where: { tenant_id: tenantId } })`,
        },
      ]),
    ).toThrow(/workshopOrder\.findMany.*active site/);
  });

  it('fails nested site-owned includes without their own site scope', () => {
    expect(() =>
      lintPrismaSiteScopeQueries([
        {
          path: 'customer.service.ts',
          content: `prisma.customer.findMany({ where: { tenant_id: tenantId }, include: { workshop_orders: true } })`,
        },
      ]),
    ).toThrow(/workshop_orders.*without site scope/);
  });

  it('accepts a stock transfer query when both site dimensions are explicit', () => {
    expect(() =>
      lintPrismaSiteScopeQueries([
        {
          path: 'stock-transfer.service.ts',
          content: `prisma.stockTransfer.findFirst({ where: { tenant_id: tenantId, from_site_id: fromSiteId, to_site_id: toSiteId } })`,
        },
      ]),
    ).not.toThrow();
  });
});
