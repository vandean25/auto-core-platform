import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTenantRestoreManifest,
  parseMigrationForeignKeyActions,
  renderExportQuery,
  renderPurgeSql,
} from './tenant-schema.mjs';

test('includes tenant tables, tenant-only children, and implicit join tables', () => {
  const schema = `
    model Tenant {
      id String @id
      records TenantRecord[]
      @@map("tenants")
    }

    model TenantRecord {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      fitments Fitment[]
      @@map("tenant_records")
    }

    model Fitment {
      id String @id
      record_id String
      record TenantRecord @relation(fields: [record_id], references: [id], onDelete: Cascade)
      @@map("fitments")
    }

    model Brand {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      vendors Vendor[] @relation("VendorBrands")
      @@map("brands")
    }

    model Vendor {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      brands Brand[] @relation("VendorBrands")
      @@map("vendors")
    }
  `;

  const manifest = buildTenantRestoreManifest(schema);

  assert.deepEqual(manifest.tables, [
    'brands',
    'tenant_records',
    'vendors',
    '_VendorBrands',
    'fitments',
  ]);
  assert.deepEqual(manifest.prePurgeMutations, []);
  assert.deepEqual(manifest.selfReferences, []);
  assert.deepEqual(
    manifest.foreignKeys.find(
      (foreignKey) => foreignKey.childTable === 'fitments',
    ),
    {
      childTable: 'fitments',
      parentTable: 'tenant_records',
      childColumns: ['record_id'],
      parentColumns: ['id'],
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
  );
});

test('includes global user cleanup without treating users as tenant data', () => {
  const schema = `
    model Tenant {
      id String @id
      memberships TenantMember[]
      @@map("tenants")
    }

    model User {
      id String @id
      active_tenant_id String?
      activeTenant Tenant? @relation(fields: [active_tenant_id], references: [id])
      memberships TenantMember[]
      @@map("users")
    }

    model TenantMember {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      user_id String
      user User @relation(fields: [user_id], references: [id])
      @@map("tenant_members")
    }
  `;

  const manifest = buildTenantRestoreManifest(schema);

  assert.deepEqual(manifest.tables, ['tenant_members']);
  assert.deepEqual(manifest.prePurgeMutations, [
    {
      table: 'users',
      columns: ['active_tenant_id'],
      condition: 'active_tenant_id',
    },
  ]);
});

test('includes nullable self-references as pre-delete nullifications', () => {
  const schema = `
    model Tenant {
      id String @id
      categories Category[]
      @@map("tenants")
    }

    model Category {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      parent_id String?
      parent Category? @relation("CategoryTree", fields: [parent_id], references: [id], onDelete: Restrict)
      children Category[] @relation("CategoryTree")
      @@map("categories")
    }
  `;

  const manifest = buildTenantRestoreManifest(schema);

  assert.deepEqual(manifest.selfReferences, [
    {
      table: 'categories',
      columns: ['parent_id'],
      nullable: true,
    },
  ]);
});

test('renders fail-closed purge SQL for dependent and global rows', () => {
  const schema = `
    model Tenant {
      id String @id
      records TenantRecord[]
      @@map("tenants")
    }

    model User {
      id String @id
      active_tenant_id String?
      activeTenant Tenant? @relation(fields: [active_tenant_id], references: [id])
      @@map("users")
    }

    model TenantRecord {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      fitments Fitment[]
      parent_id String?
      parent TenantRecord? @relation("RecordTree", fields: [parent_id], references: [id])
      children TenantRecord[] @relation("RecordTree")
      @@map("tenant_records")
    }

    model Fitment {
      id String @id
      record_id String
      record TenantRecord @relation(fields: [record_id], references: [id], onDelete: Cascade)
      @@map("fitments")
    }
  `;

  const sql = renderPurgeSql(buildTenantRestoreManifest(schema));

  assert.match(
    sql,
    /UPDATE public\."users"\s+SET "active_tenant_id" = NULL/,
  );
  assert.match(
    sql,
    /UPDATE public\."tenant_records"\s+SET "parent_id" = NULL/,
  );
  assert.match(
    sql,
    /DELETE FROM public\."fitments" AS child[\s\S]*FROM public\."tenant_records" AS parent/,
  );
  assert.match(sql, /tenant_restore_expected_tables/);
  assert.match(sql, /tenant_restore_expected_foreign_keys/);
  assert.match(sql, /pg_constraint/);
  assert.match(sql, /tenant_records/);
});

test('renders filtered COPY queries instead of pg_dump commands', () => {
  const schema = `
    model Tenant {
      id String @id
      records TenantRecord[]
      @@map("tenants")
    }

    model TenantRecord {
      id String @id
      tenant_id String
      tenant Tenant @relation(fields: [tenant_id], references: [id])
      fitments Fitment[]
      @@map("tenant_records")
    }

    model Fitment {
      id String @id
      record_id String
      record TenantRecord @relation(fields: [record_id], references: [id], onDelete: Cascade)
      @@map("fitments")
    }
  `;
  const manifest = buildTenantRestoreManifest(schema);

  assert.match(
    renderExportQuery(manifest.definitions[0]),
    /COPY \(SELECT \* FROM public\."tenant_records" WHERE "tenant_id" = :'target_tenant_id'\)/,
  );
  assert.match(
    renderExportQuery(manifest.definitions[1]),
    /SELECT child\.\* FROM public\."fitments" AS child/,
  );
  assert.match(
    renderExportQuery(manifest.definitions[1]),
    /parent_0\."tenant_id" = :'target_tenant_id'/,
  );
});

test('keeps runtime schema-check temp tables alive for the full check', () => {
  const sql = renderPurgeSql({
    tables: ['tenant_records'],
    definitions: [
      {
        table: 'tenant_records',
        kind: 'tenant',
        dependencies: [],
        scopeRelations: [],
      },
    ],
    prePurgeMutations: [],
    selfReferences: [],
    foreignKeys: [],
  });

  assert.ok(
    sql.indexOf('BEGIN;') < sql.indexOf('CREATE TEMP TABLE tenant_restore_expected_tables'),
  );
  assert.ok(
    sql.indexOf('COMMIT;') < sql.lastIndexOf('BEGIN;'),
  );
});

test('uses migration FK actions when Prisma defaults are not the live contract', () => {
  const actions = parseMigrationForeignKeyActions(`
    ALTER TABLE "invoices"
      ADD CONSTRAINT "invoices_tenant_id_sales_order_id_fkey"
      FOREIGN KEY ("tenant_id", "sales_order_id")
      REFERENCES "sales_orders"("tenant_id", "id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  `);

  assert.deepEqual(
    actions.get(
      'invoices|sales_orders|tenant_id,sales_order_id|tenant_id,id',
    ),
    {
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  );
});
