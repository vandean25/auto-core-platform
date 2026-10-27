import { ImportEntityType } from '@prisma/client';
import { serializeCsv, parseCsvFile } from './csv-parse.util.js';
import {
  IMPORT_RECONCILE_GROUP_MAX_ROWS,
  oversizedRowNosFromParsedCsv,
} from './import-dry-run-group-limit.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { planCustomerDryRun } from './customer-import.dry-run.js';

describe('import dry-run group cap', () => {
  it('flags every row in a group larger than the cap', () => {
    const mapping = {
      external_id: 'id',
      type: 'type',
      first_name: 'first',
      last_name: 'last',
      email: 'email',
      phone: 'phone',
      vat_id: 'vat',
      address_country: 'country',
    };
    const rows = Array.from({ length: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1 }, (_, index) => [
      `c${index}`,
      'PRIVATE',
      'A',
      'One',
      'same@example.com',
      '',
      '',
      'AT',
    ]);
    const parsed = parseCsvFile(
      Buffer.from(serializeCsv(Object.values(mapping), rows), 'utf8'),
    );
    const oversized = oversizedRowNosFromParsedCsv(
      parsed,
      mapping,
      ImportEntityType.CUSTOMER,
    );
    expect(oversized.size).toBe(IMPORT_RECONCILE_GROUP_MAX_ROWS + 1);
  });

  it('sync customer plan marks oversized email groups as IMPORT_GROUP_TOO_LARGE', async () => {
    const mapping = {
      external_id: 'id',
      type: 'type',
      first_name: 'first',
      last_name: 'last',
      email: 'email',
      phone: 'phone',
      vat_id: 'vat',
      address_country: 'country',
    };
    const rows = Array.from({ length: IMPORT_RECONCILE_GROUP_MAX_ROWS + 1 }, (_, index) => [
      `c${index}`,
      'PRIVATE',
      'A',
      'One',
      'same@example.com',
      '',
      '',
      'AT',
    ]);
    const parsed = parseCsvFile(
      Buffer.from(serializeCsv(Object.values(mapping), rows), 'utf8'),
    );
    const prisma = {
      externalIdMapping: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const planned = await planCustomerDryRun(prisma as never, {
      tenantId: 't',
      sourceSystem: 'legacy',
      mapping,
      options: {},
    }, parsed);
    expect(planned).toHaveLength(IMPORT_RECONCILE_GROUP_MAX_ROWS + 1);
    for (const row of planned) {
      expect(row.errors[0]?.code).toBe(IMPORT_ERROR_CODES.GROUP_TOO_LARGE);
    }
  });
});
