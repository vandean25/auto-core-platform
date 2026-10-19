import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { buildCanonicalMigrationIdentityMapping } from '../../src/import/canonical-migration-preset.js';
import { serializeCsv } from '../../src/import/csv-parse.util.js';
import { CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM } from '../../src/prisma/fixtures/canonical-migration-import-presets.fixture.js';

const VEHICLE_OWNER_CUSTOMER_HEADERS = [
  'external_id',
  'type',
  'company_name',
  'first_name',
  'last_name',
  'email',
  'phone',
  'vat_id',
  'address_street',
  'address_zip',
  'address_city',
  'address_country',
  'salutation',
  'title',
  'title_suffix',
  'letter_salutation',
  'block_level',
  'block_reason',
  'payment_terms_days',
  'payment_terms_text',
  'bill_to_external_id',
  'labor_price_group_code',
  'last_activity_date',
  'has_open_matters',
  'privacy_objection',
  'mail_stop',
  'anonymized',
];

const VEHICLE_OWNER_CUSTOMER_ROWS: string[][] = [
  [
    'cust-001',
    'PRIVATE',
    '',
    'Erika',
    'Müller',
    'erika.mueller@example.invalid',
    '',
    '',
    '',
    '',
    '',
    'AT',
    '',
    '',
    '',
    '',
    'NONE',
    '',
    '',
    '',
    '',
    '',
    '2025-06-01',
    'false',
    'false',
    'false',
    'false',
  ],
  [
    'cust-002',
    'COMPANY',
    'Synth Fleet GmbH',
    '',
    '',
    'fleet@example.invalid',
    '',
    '',
    '',
    '',
    '',
    'AT',
    '',
    '',
    '',
    '',
    'NONE',
    '',
    '',
    '',
    '',
    '',
    '2024-01-15',
    'true',
    'false',
    'false',
    'false',
  ],
];

export async function applyCanonicalMigrationVehicleOwnerCustomers(
  app: INestApplication,
  authHeader: string,
): Promise<void> {
  const ownerCsv = serializeCsv(
    VEHICLE_OWNER_CUSTOMER_HEADERS,
    VEHICLE_OWNER_CUSTOMER_ROWS,
    ',',
  );
  const applyJob = await request(app.getHttpServer())
    .post('/imports')
    .set('Authorization', authHeader)
    .field('entityType', 'CUSTOMER')
    .field('sourceSystem', CANONICAL_MIGRATION_FIXTURE_SOURCE_SYSTEM)
    .field(
      'mapping',
      JSON.stringify(buildCanonicalMigrationIdentityMapping('CUSTOMER')),
    )
    .attach('file', Buffer.from(ownerCsv, 'utf8'), 'customers.csv')
    .expect(201);
  await request(app.getHttpServer())
    .post(`/imports/${applyJob.body.id}/apply`)
    .set('Authorization', authHeader)
    .expect(200);
}
