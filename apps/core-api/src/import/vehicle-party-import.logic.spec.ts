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

    expect(errorCodes(results[0])).toContain(CANONICAL_ROW_ISSUE_CODES.UNKNOWN_VEHICLE);
    expect(errorCodes(results[1])).toContain(CANONICAL_ROW_ISSUE_CODES.UNKNOWN_CUSTOMER);
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

    expect(errorCodes(results[0])).toContain(CANONICAL_ROW_ISSUE_CODES.VALUE_INVALID);
    expect(errorCodes(results[1])).toContain(CANONICAL_ROW_ISSUE_CODES.VALUE_INVALID);
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
        csvRow(2, { role: 'PREVIOUS_OWNER', valid_from: '', valid_to: '2026-11-02' }),
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
          csvRow(2, { customer_external_id: 'CUSTOMER-B', valid_from: '2025-01-01' }),
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
          csvRow(2, { customer_external_id: 'CUSTOMER-B', valid_from: '2024-01-01' }),
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
        [csvRow(1, { customer_external_id: 'CUSTOMER-B', valid_from: '2025-01-01' })],
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
      expect(errorCodes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.IDENTITY_CHANGED);
    });

    it('plans an owner transfer: end the old interval, create the new owner', () => {
      const results = planVehiclePartyRows(
        [
          csvRow(2, { customer_external_id: 'CUSTOMER-B', valid_from: '2026-06-01' }),
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
          csvRow(2, { customer_external_id: 'CUSTOMER-B', valid_from: '2026-06-01' }),
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
});
