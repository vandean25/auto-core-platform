import { ImportRowAction } from '@prisma/client';
import {
  normalizeCustomerRow,
  planCustomerDryRunRow,
} from './customer-import.logic.js';

const mapping = {
  external_id: 'Kunden-Nr',
  type: 'Typ',
  first_name: 'Vorname',
  last_name: 'Nachname',
  email: 'E-Mail',
  vat_id: 'UID',
  address_country: 'Land',
};

describe('customer-import.logic', () => {
  it('flags invalid AT UID as warning by default', () => {
    const result = normalizeCustomerRow(
      {
        'Kunden-Nr': '1001',
        Typ: 'PRIVATE',
        Vorname: 'Max',
        Nachname: 'Muster',
        UID: 'bad',
        Land: 'AT',
      },
      mapping,
      {},
    );
    expect(result.row?.vat_id).toBeNull();
    expect(result.warnings.some((w) => w.code === 'CUSTOMER_VAT_ID_INVALID')).toBe(
      true,
    );
  });

  it('plans CREATE when no mapping or email match exists', () => {
    const row = normalizeCustomerRow(
      {
        'Kunden-Nr': '2002',
        Vorname: 'Erika',
        Nachname: 'Demo',
        'E-Mail': 'erika@example.com',
      },
      mapping,
      {},
    ).row!;
    const planned = planCustomerDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map(),
        customerByEmail: new Map(),
        customerById: new Map(),
        duplicateNameKeys: new Set(),
        externalIdSeenInFile: new Map(),
        emailSeenInFile: new Map(),
      },
      {},
      [],
    );
    expect(planned.action).toBe(ImportRowAction.CREATE);
  });

  it('does not warn on possible duplicate for a unique new name', () => {
    const row = normalizeCustomerRow(
      {
        'Kunden-Nr': '3003',
        Vorname: 'Unique',
        Nachname: 'Person',
      },
      mapping,
      {},
    ).row!;
    const planned = planCustomerDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map(),
        customerByEmail: new Map(),
        customerById: new Map(),
        duplicateNameKeys: new Set(),
        externalIdSeenInFile: new Map(),
        emailSeenInFile: new Map(),
      },
      {},
      [],
    );
    expect(
      planned.warnings.some((w) => w.code === 'IMPORT_POSSIBLE_DUPLICATE'),
    ).toBe(false);
  });

  it('errors on duplicate external_id in one file', () => {
    const context = {
      mappingByExternalId: new Map(),
      customerByEmail: new Map(),
      customerById: new Map(),
      duplicateNameKeys: new Set(),
      externalIdSeenInFile: new Map([['dup', 1]]),
      emailSeenInFile: new Map(),
    };
    const row = normalizeCustomerRow(
      {
        'Kunden-Nr': 'dup',
        Vorname: 'A',
        Nachname: 'B',
      },
      mapping,
      {},
    ).row!;
    const planned = planCustomerDryRunRow(2, row, context, {}, []);
    expect(planned.action).toBe(ImportRowAction.ERROR);
    expect(planned.errors[0]?.code).toBe(
      'IMPORT_DUPLICATE_EXTERNAL_ID_IN_FILE',
    );
  });

  it('ignores consent columns with warning', () => {
    const result = normalizeCustomerRow(
      {
        'Kunden-Nr': '1',
        Vorname: 'A',
        Nachname: 'B',
        newsletter: 'yes',
      },
      mapping,
      {},
    );
    expect(
      result.warnings.some((w) => w.code === 'IMPORT_CONSENT_COLUMN_IGNORED'),
    ).toBe(true);
  });
});
