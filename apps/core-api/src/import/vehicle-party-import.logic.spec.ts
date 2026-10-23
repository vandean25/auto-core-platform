import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { CANONICAL_ROW_ISSUE_CODES } from './canonical-csv-cell.util.js';
import {
  planVehiclePartyRows,
  type PartyPlanContext,
  type StoredParty,
} from './vehicle-party-import.logic.js';

const MAPPING = Object.fromEntries(
  [
    'external_id',
    'vehicle_external_id',
    'customer_external_id',
    'role',
    'valid_from',
    'valid_to',
    'notes',
  ].map((name) => [name, name]),
);

const csvRow = (
  rowNo: number,
  fields: Partial<Record<string, string>>,
): { rowNo: number; record: Record<string, string> } => ({
  rowNo,
  record: {
    external_id: `PARTY-${rowNo}`,
    vehicle_external_id: 'VEHICLE-001',
    customer_external_id: 'CUSTOMER-A',
    role: 'OWNER',
    valid_from: '2024-01-01',
    valid_to: '',
    notes: '',
    ...fields,
  },
});

function context(overrides: Partial<PartyPlanContext> = {}): PartyPlanContext {
  return {
    vehicleIdByExternalId: new Map([['VEHICLE-001', 'veh-1']]),
    customerIdByExternalId: new Map([
      ['CUSTOMER-A', 'cust-a'],
      ['CUSTOMER-B', 'cust-b'],
      ['CUSTOMER-L', 'cust-l'],
    ]),
    partyIdByExternalId: new Map(),
    storedParties: [],
    vehicleContact: new Map([['veh-1', null]]),
    options: { cutover_date: '2026-11-01' },
    today: '2026-11-01',
    ...overrides,
  };
}

const stored = (overrides: Partial<StoredParty>): StoredParty => ({
  id: 'p-stored',
  vehicle_id: 'veh-1',
  customer_id: 'cust-a',
  role: 'OWNER',
  valid_from: '2024-01-01',
  valid_to: null,
  notes: null,
  source: 'MANUAL',
  ...overrides,
});

const errorCodes = (result: { errors: Array<{ code: string }> }) =>
  result.errors.map((issue) => issue.code);

describe('planVehiclePartyRows', () => {
  it('plans a CREATE with resolved vehicle and customer ids', () => {
    const [result] = planVehiclePartyRows([csvRow(1, {})], MAPPING, context());

    expect(result.action).toBe(ImportRowAction.CREATE);
    expect(result.normalized).toMatchObject({
      external_id: 'PARTY-1',
      vehicle_id: 'veh-1',
      customer_id: 'cust-a',
      role: 'OWNER',
      valid_from: '2024-01-01',
      valid_to: null,
    });
  });

  it('reports unknown vehicle and customer references as row errors', () => {
    const results = planVehiclePartyRows(
      [
        csvRow(1, { vehicle_external_id: 'VEHICLE-404' }),
        csvRow(2, { customer_external_id: 'CUSTOMER-404', role: 'DRIVER' }),
      ],
      MAPPING,
      context(),
    );

    expect(errorCodes(results[0])).toContain(
      CANONICAL_ROW_ISSUE_CODES.UNKNOWN_VEHICLE,
    );
    expect(errorCodes(results[1])).toContain(
      CANONICAL_ROW_ISSUE_CODES.UNKNOWN_CUSTOMER,
    );
    expect(results.map((r) => r.action)).toEqual([
      ImportRowAction.ERROR,
      ImportRowAction.ERROR,
    ]);
  });

  it('rejects invalid role, invalid dates and duplicate external ids', () => {
    const results = planVehiclePartyRows(
      [
        csvRow(1, { role: 'BOSS' }),
        csvRow(2, { valid_from: '2024-13-40', role: 'DRIVER' }),
        csvRow(3, { external_id: 'DUP', role: 'DRIVER' }),
        csvRow(4, { external_id: 'DUP', role: 'USER' }),
      ],
      MAPPING,
      context(),
    );

    expect(errorCodes(results[0])).toContain(
      CANONICAL_ROW_ISSUE_CODES.VALUE_INVALID,
    );
    expect(errorCodes(results[1])).toContain(
      CANONICAL_ROW_ISSUE_CODES.VALUE_INVALID,
    );
    expect(results[2].action).toBe(ImportRowAction.CREATE);
    expect(errorCodes(results[3])).toContain(
      IMPORT_ERROR_CODES.DUPLICATE_EXTERNAL_ID_IN_FILE,
    );
  });

  it.each(['OWNER', 'BILL_TO', 'LEASING'])(
    'reports a future-dated %s as MIGRATION_UNSUPPORTED_CAPABILITY, not a crash',
    (role) => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, { role, valid_from: '2027-01-01' })],
        MAPPING,
        context(),
      );

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toEqual(['MIGRATION_UNSUPPORTED_CAPABILITY']);
    },
  );

  it('accepts a future-dated DRIVER', () => {
    const [result] = planVehiclePartyRows(
      [csvRow(1, { role: 'DRIVER', valid_from: '2027-01-01' })],
      MAPPING,
      context(),
    );
    expect(result.action).toBe(ImportRowAction.CREATE);
  });

  it('requires PREVIOUS_OWNER valid_to on or before the cutover date', () => {
    const results = planVehiclePartyRows(
      [
        csvRow(1, { role: 'PREVIOUS_OWNER', valid_from: '', valid_to: '' }),
        csvRow(2, {
          role: 'PREVIOUS_OWNER',
          valid_from: '',
          valid_to: '2026-11-02',
        }),
        csvRow(3, {
          role: 'PREVIOUS_OWNER',
          customer_external_id: 'CUSTOMER-B',
          valid_from: '',
          valid_to: '2020-01-01',
        }),
      ],
      MAPPING,
      context(),
    );

    expect(errorCodes(results[0])).toContain(
      'VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED',
    );
    expect(errorCodes(results[1])).toContain(
      'VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED',
    );
    expect(results[2].action).toBe(ImportRowAction.CREATE);
  });

  describe('timeline overlaps', () => {
    it('blocks overlapping OWNER rows inside the file', () => {
      const results = planVehiclePartyRows(
        [
          csvRow(1, {}),
          csvRow(2, {
            customer_external_id: 'CUSTOMER-B',
            valid_from: '2025-01-01',
          }),
        ],
        MAPPING,
        context(),
      );

      expect(results.map((r) => r.action)).toEqual([
        ImportRowAction.ERROR,
        ImportRowAction.ERROR,
      ]);
      expect(errorCodes(results[1])).toContain('VEHICLE_PARTY_OVERLAP');
    });

    it('allows adjacent half-open intervals in the file', () => {
      const results = planVehiclePartyRows(
        [
          csvRow(1, { valid_from: '2020-01-01', valid_to: '2024-01-01' }),
          csvRow(2, {
            customer_external_id: 'CUSTOMER-B',
            valid_from: '2024-01-01',
          }),
        ],
        MAPPING,
        context(),
      );

      expect(results.map((r) => r.action)).toEqual([
        ImportRowAction.CREATE,
        ImportRowAction.CREATE,
      ]);
    });

    it('checks the file against untouched target parties', () => {
      const [result] = planVehiclePartyRows(
        [
          csvRow(1, {
            customer_external_id: 'CUSTOMER-B',
            valid_from: '2025-01-01',
          }),
        ],
        MAPPING,
        context({ storedParties: [stored({})] }),
      );

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain('VEHICLE_PARTY_OVERLAP');
    });
  });

  describe('replay and owner transfer', () => {
    const storedMapped = stored({ id: 'p-1', customer_id: 'cust-a' });
    const mapped = new Map([['PARTY-1', 'p-1']]);

    it('skips an identical replay', () => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, {})],
        MAPPING,
        context({
          partyIdByExternalId: mapped,
          storedParties: [storedMapped],
          vehicleContact: new Map([['veh-1', 'cust-a']]),
        }),
      );

      expect(result.action).toBe(ImportRowAction.SKIP);
      expect(result.entity_id).toBe('p-1');
    });

    it('blocks a changed identity on a mapped id', () => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, { customer_external_id: 'CUSTOMER-B' })],
        MAPPING,
        context({ partyIdByExternalId: mapped, storedParties: [storedMapped] }),
      );

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain(
        CANONICAL_ROW_ISSUE_CODES.IDENTITY_CHANGED,
      );
    });

    it('plans an owner transfer: end the old interval, create the new owner', () => {
      const results = planVehiclePartyRows(
        [
          csvRow(2, {
            customer_external_id: 'CUSTOMER-B',
            valid_from: '2026-06-01',
          }),
          csvRow(1, { valid_to: '2026-06-01' }),
        ],
        MAPPING,
        context({
          partyIdByExternalId: mapped,
          storedParties: [storedMapped],
          vehicleContact: new Map([['veh-1', 'cust-a']]),
          options: { cutover_date: '2026-11-01', update_existing: true },
        }),
      );

      expect(results.map((r) => r.action)).toEqual([
        ImportRowAction.CREATE,
        ImportRowAction.UPDATE,
      ]);
      expect(results[1].entity_id).toBe('p-1');
    });

    it('keeps the stored interval when updates are not enabled, so the new owner overlaps', () => {
      const results = planVehiclePartyRows(
        [
          csvRow(1, { valid_to: '2026-06-01' }),
          csvRow(2, {
            customer_external_id: 'CUSTOMER-B',
            valid_from: '2026-06-01',
          }),
        ],
        MAPPING,
        context({ partyIdByExternalId: mapped, storedParties: [storedMapped] }),
      );

      expect(results[0].action).toBe(ImportRowAction.SKIP);
      expect(results[0].warnings.length).toBeGreaterThan(0);
      expect(results[1].action).toBe(ImportRowAction.ERROR);
    });
  });

  describe('main contact reconciliation', () => {
    it('blocks an active OWNER that conflicts with an existing contact that has no OWNER party', () => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, {})],
        MAPPING,
        context({ vehicleContact: new Map([['veh-1', 'cust-x']]) }),
      );

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain(
        CANONICAL_ROW_ISSUE_CODES.OWNER_CONTACT_CONFLICT,
      );
    });

    it('blocks a file that ends the owner without a successor while a main contact exists', () => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, { valid_to: '2026-06-01' })],
        MAPPING,
        context({
          partyIdByExternalId: new Map([['PARTY-1', 'p-1']]),
          storedParties: [stored({ id: 'p-1', customer_id: 'cust-a' })],
          vehicleContact: new Map([['veh-1', 'cust-a']]),
          options: { cutover_date: '2026-11-01', update_existing: true },
        }),
      );

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain(
        CANONICAL_ROW_ISSUE_CODES.OWNER_CONTACT_CONFLICT,
      );
    });

    it('accepts an OWNER that matches the existing contact', () => {
      const [result] = planVehiclePartyRows(
        [csvRow(1, {})],
        MAPPING,
        context({ vehicleContact: new Map([['veh-1', 'cust-a']]) }),
      );
      expect(result.action).toBe(ImportRowAction.CREATE);
    });
  });
  describe('adopting an OWNER the vehicles.csv import started', () => {
    // vehicles.csv created the vehicle with its owner on the import day.
    const importedToday = (overrides: Partial<StoredParty> = {}) =>
      stored({
        id: 'p-import',
        valid_from: '2026-11-01',
        source: 'LEGACY_IMPORT',
        ...overrides,
      });
    const plan = (
      fields: Partial<Record<string, string>>,
      storedParties: StoredParty[],
      overrides: Partial<PartyPlanContext> = {},
    ) =>
      planVehiclePartyRows(
        [csvRow(1, fields)],
        MAPPING,
        context({
          storedParties,
          vehicleContact: new Map([['veh-1', 'cust-a']]),
          ...overrides,
        }),
      )[0];

    it('plans an UPDATE of that party to the earlier day instead of an overlap', () => {
      const result = plan({ valid_from: '2024-01-01' }, [importedToday()]);

      expect(result).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'p-import',
        errors: [],
        normalized: {
          external_id: 'PARTY-1',
          customer_id: 'cust-a',
          valid_from: '2024-01-01',
          adopts_existing: true,
        },
      });
    });

    it('also adopts on the same day', () => {
      const result = plan({ valid_from: '2026-11-01' }, [importedToday()]);

      expect(result.action).toBe(ImportRowAction.UPDATE);
    });

    it('does not adopt a MANUAL owner', () => {
      const result = plan({}, [importedToday({ source: 'MANUAL' })]);

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain('VEHICLE_PARTY_OVERLAP');
    });

    it('does not adopt for another customer', () => {
      const result = plan({ customer_external_id: 'CUSTOMER-B' }, [
        importedToday(),
      ]);

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain('VEHICLE_PARTY_OVERLAP');
    });

    it('does not adopt with a closed row that overlaps the imported owner', () => {
      const result = plan({ valid_to: '2027-01-01' }, [importedToday()]);

      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(errorCodes(result)).toContain('VEHICLE_PARTY_OVERLAP');
    });

    it('does not adopt a row that starts after the imported owner', () => {
      const result = plan({ valid_from: '2026-11-01' }, [
        importedToday({ valid_from: '2026-10-01' }),
      ]);

      expect(result.action).toBe(ImportRowAction.ERROR);
    });

    it('does not adopt an OWNER that is already closed', () => {
      const result = plan({}, [importedToday({ valid_to: '2027-01-01' })]);

      expect(result.action).not.toBe(ImportRowAction.UPDATE);
    });

    it('does not adopt a party of another role for the same customer', () => {
      const result = plan({}, [importedToday({ role: 'BILL_TO' })]);

      expect(result.action).toBe(ImportRowAction.CREATE);
      expect(result.entity_id).toBeNull();
    });

    it('adopts a row without a start day and keeps the stored day', () => {
      const result = plan({ valid_from: '' }, [importedToday()]);

      expect(result).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'p-import',
        normalized: { valid_from: null, adopts_existing: true },
      });
    });

    it('does not adopt a party that already carries an external id', () => {
      const result = plan({}, [importedToday()], {
        partyIdByExternalId: new Map([['OTHER', 'p-import']]),
      });

      expect(result.action).toBe(ImportRowAction.ERROR);
    });

    it('never adopts for two rows of one file', () => {
      const results = planVehiclePartyRows(
        [csvRow(1, {}), csvRow(2, {})],
        MAPPING,
        context({
          storedParties: [importedToday()],
          vehicleContact: new Map([['veh-1', 'cust-a']]),
        }),
      );

      // Only one row may take the party over, and the two open OWNER rows overlap each other.
      expect(results.map((result) => result.action)).toEqual([
        ImportRowAction.ERROR,
        ImportRowAction.ERROR,
      ]);
    });
  });
});
