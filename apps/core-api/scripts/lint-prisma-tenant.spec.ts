import { lintPrismaTenantSchema } from './lint-prisma-tenant.js';
import { lintPrismaSiteScopeSchema } from './lint-prisma-site-scope.js';

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

    expect(() => lintPrismaTenantSchema(badSchema)).toThrow(/field-level @unique/);
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

    expect(() => lintPrismaTenantSchema(badSchema)).toThrow(/does not start with 'tenant_id'/);
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
});
