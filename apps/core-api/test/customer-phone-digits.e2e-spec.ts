import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { normalizePhone } from '../src/customer/customer-phone.util.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createE2eApp } from './helpers/e2e-suite.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestTenant,
  type TestTenantResult,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

const SAMPLE_PHONES = [
  null,
  '',
  '   ',
  'abc',
  '+43 664 1234567',
  '0043 664 1234567',
  '43 664 1234567',
  '43',
  '0664/1234567',
  '0664-123 45 67',
  '06641234567',
  '0664 12',
  '+49 170 1234567',
  '0049 170 1234567',
  '00',
  '0043',
];

const MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    'prisma/migrations/20261023120000_aut698_customer_phone_digits/migration.sql',
  ),
  'utf8',
);

/**
 * AUT-698: customers.phone_digits must equal normalizePhone(phone) in the
 * migration backfill expression.
 */
describe('Customer phone_digits (e2e)', () => {
  let app: INestApplication;
  let basePrisma: PrismaService;
  let tenant: TestTenantResult;
  let tenantPrisma: PrismaService;

  beforeAll(async () => {
    app = await createE2eApp();
    basePrisma = app.get<PrismaService>(PrismaService);
    tenant = await createTestTenant(basePrisma, 'phone-digits');
    tenantPrisma = createTenantAwarePrisma(basePrisma, tenant.tenantId);
  });

  afterAll(async () => {
    if (!app) return;
    try {
      await cleanupTestTenantGraph(basePrisma, tenant.tenantId);
    } finally {
      await teardownTestApp(app, basePrisma);
    }
  });

  it('migration backfill SQL agrees with normalizePhone on sample numbers', async () => {
    const statement = MIGRATION_SQL.match(
      /WITH extracted AS[\s\S]+WHERE c\.id = e\.id;/,
    )![0];
    const created = await Promise.all(
      SAMPLE_PHONES.map((phone, index) =>
        tenantPrisma.customer.create({
          data: {
            tenant_id: tenant.tenantId,
            type: 'PRIVATE',
            first_name: `Parity${index}`,
            last_name: 'Phone',
            email: `parity-phone-${index}@example.test`,
            phone,
            phone_digits: null,
          },
        }),
      ),
    );
    expect(created.every((row) => row.phone_digits === null)).toBe(true);

    await basePrisma.$executeRawUnsafe(statement);

    const rows = await tenantPrisma.customer.findMany({
      where: { id: { in: created.map((row) => row.id) } },
      select: { phone: true, phone_digits: true },
    });
    expect(rows).toHaveLength(SAMPLE_PHONES.length);
    for (const row of rows) {
      expect(row.phone_digits).toBe(normalizePhone(row.phone));
    }
  });
});
