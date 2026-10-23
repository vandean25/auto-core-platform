import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { CANONICAL_ROW_ISSUE_CODES } from './canonical-csv-cell.util.js';
import {
  planVehicleDueDateRows,
  type DueDatePlanContext,
  type StoredInspection,
  type StoredServiceNotice,
} from './vehicle-due-date-import.logic.js';

const MAPPING = Object.fromEntries(
  [
    'external_id',
    'vehicle_external_id',
    'kind',
    'inspected_on',
    'plaketten_valid_until_year',
    'plaketten_valid_until_month',
    'due_date',
    'due_mileage',
    'external_ref',
    'station_name',
    'notes',
  ].map((name) => [name, name]),
);

const BLANK = {
  inspected_on: '',
  plaketten_valid_until_year: '',
  plaketten_valid_until_month: '',
  due_date: '',
  due_mileage: '',
  external_ref: '',
  station_name: '',
  notes: '',
};

const inspectionRow = (
  rowNo: number,
  fields: Partial<Record<string, string>> = {},
) => ({
  rowNo,
  record: {
    external_id: `DUE-${rowNo}`,
    vehicle_external_id: 'VEHICLE-001',
    kind: 'INSPECTION_57A',
    ...BLANK,
    inspected_on: '2026-06-15',
    plaketten_valid_until_year: '2027',
    plaketten_valid_until_month: '6',
    external_ref: 'REPORT-001',
    station_name: 'Example station',
    ...fields,
  } as Record<string, string>,
});

const serviceRow = (
  rowNo: number,
  fields: Partial<Record<string, string>> = {},
) => ({
  rowNo,
  record: {
    external_id: `DUE-${rowNo}`,
    vehicle_external_id: 'VEHICLE-001',
    kind: 'SERVICE',
    ...BLANK,
    due_date: '2027-01-15',
    due_mileage: '60000',
    external_ref: 'SERVICE-001',
    ...fields,
  } as Record<string, string>,
});

function context(
  overrides: Partial<DueDatePlanContext> = {},
): DueDatePlanContext {
  return {
    vehicleIdByExternalId: new Map([['VEHICLE-001', 'veh-1']]),
    dueIdByExternalId: new Map(),
    inspections: [],
    serviceNotices: [],
    options: { cutover_date: '2026-11-01' },
    today: '2026-11-01',
    ...overrides,
  };
}

const storedInspection = (
  overrides: Partial<StoredInspection> = {},
): StoredInspection => ({
  id: 'insp-1',
  vehicle_id: 'veh-1',
  inspected_on: '2026-06-15',
  plaketten_valid_until_year: 2027,
  plaketten_valid_until_month: 6,
  station_name: 'Example station',
  notes: null,
  ...overrides,
});

const storedNotice = (
  overrides: Partial<StoredServiceNotice> = {},
): StoredServiceNotice => ({
  id: 'notice-1',
  vehicle_id: 'veh-1',
  external_ref: 'SERVICE-001',
  status: 'OPEN',
  body: null,
  due_date: '2027-01-15',
  due_mileage: 60000,
  ...overrides,
});

const codes = (result: { errors: Array<{ code: string }> }) =>
  result.errors.map((issue) => issue.code);

describe('planVehicleDueDateRows', () => {
  it('plans an INSPECTION_57A create with the canonical evidence fields', () => {
    const [result] = planVehicleDueDateRows(
      [inspectionRow(1)],
      MAPPING,
      context(),
    );

    expect(result.action).toBe(ImportRowAction.CREATE);
    expect(result.normalized).toMatchObject({
      kind: 'INSPECTION_57A',
      vehicle_id: 'veh-1',
      inspected_on: '2026-06-15',
      plaketten_valid_until_year: 2027,
      plaketten_valid_until_month: 6,
      station_name: 'Example station',
    });
  });

  it('plans a SERVICE create with due date and mileage', () => {
    const [result] = planVehicleDueDateRows([serviceRow(1)], MAPPING, context());

    expect(result.action).toBe(ImportRowAction.CREATE);
    expect(result.normalized).toMatchObject({
      kind: 'SERVICE',
      due_date: '2027-01-15',
      due_mileage: 60000,
      external_ref: 'SERVICE-001',
    });
  });

  it('reports an unknown vehicle as a row error', () => {
    const [result] = planVehicleDueDateRows(
      [serviceRow(1, { vehicle_external_id: 'VEHICLE-404' })],
      MAPPING,
      context(),
    );
    expect(result.action).toBe(ImportRowAction.ERROR);
    expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.UNKNOWN_VEHICLE);
  });

  it.each(['constructor', 'toString', 'BOGUS'])(
    'rejects kind %s',
    (kind) => {
      const [result] = planVehicleDueDateRows(
        [inspectionRow(1, { kind })],
        MAPPING,
        context(),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.VALUE_INVALID);
    },
  );

  describe('INSPECTION_57A rules', () => {
    it.each([
      ['missing inspected_on', { inspected_on: '' }],
      ['year out of range', { plaketten_valid_until_year: '1899' }],
      ['month 13', { plaketten_valid_until_month: '13' }],
      ['month with a leading zero', { plaketten_valid_until_month: '06' }],
      ['validity month before the inspection month', { plaketten_valid_until_year: '2026', plaketten_valid_until_month: '5' }],
      ['inspected after the cutover', { inspected_on: '2026-11-02', plaketten_valid_until_year: '2027' }],
      ['a due date on an inspection row', { due_date: '2027-01-01' }],
      ['a due mileage on an inspection row', { due_mileage: '1000' }],
    ])('rejects %s', (_label, fields) => {
      const [result] = planVehicleDueDateRows(
        [inspectionRow(1, fields)],
        MAPPING,
        context(),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
    });

    it('accepts a validity month earlier than the next anniversary', () => {
      const [result] = planVehicleDueDateRows(
        [inspectionRow(1, { plaketten_valid_until_year: '2026', plaketten_valid_until_month: '6' })],
        MAPPING,
        context(),
      );
      expect(result.action).toBe(ImportRowAction.CREATE);
    });

    it('blocks two inspections on the same vehicle and day, and duplicate report references', () => {
      const sameDay = planVehicleDueDateRows(
        [
          inspectionRow(1, { external_ref: 'R-1' }),
          inspectionRow(2, { plaketten_valid_until_year: '2028', external_ref: 'R-2' }),
        ],
        MAPPING,
        context(),
      );
      expect(sameDay.map((r) => r.action)).toEqual([
        ImportRowAction.ERROR,
        ImportRowAction.ERROR,
      ]);
      expect(codes(sameDay[0])).toContain(CANONICAL_ROW_ISSUE_CODES.NATURAL_KEY_CONFLICT);

      const sameReference = planVehicleDueDateRows(
        [
          inspectionRow(1, { inspected_on: '2026-01-10', plaketten_valid_until_year: '2027', plaketten_valid_until_month: '1' }),
          inspectionRow(2, { inspected_on: '2026-06-15' }),
        ],
        MAPPING,
        context(),
      );
      expect(sameReference.map((r) => r.action)).toEqual([
        ImportRowAction.ERROR,
        ImportRowAction.ERROR,
      ]);
    });

    it('blocks an unmapped record that already exists for the same vehicle and day', () => {
      const [result] = planVehicleDueDateRows(
        [inspectionRow(1)],
        MAPPING,
        context({ inspections: [storedInspection()] }),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.NATURAL_KEY_CONFLICT);
    });

    it('skips an identical replay and blocks changed evidence', () => {
      const ctx = context({
        dueIdByExternalId: new Map([['DUE-1', 'insp-1']]),
        inspections: [storedInspection()],
      });

      const [replay] = planVehicleDueDateRows([inspectionRow(1)], MAPPING, ctx);
      expect(replay.action).toBe(ImportRowAction.SKIP);

      const [changed] = planVehicleDueDateRows(
        [inspectionRow(1, { plaketten_valid_until_year: '2028' })],
        MAPPING,
        ctx,
      );
      expect(changed.action).toBe(ImportRowAction.ERROR);
      expect(codes(changed)).toContain(CANONICAL_ROW_ISSUE_CODES.EVIDENCE_IMMUTABLE);
    });
  });

  describe('SERVICE rules', () => {
    it.each([
      ['no external_ref', { external_ref: '' }],
      ['neither due_date nor due_mileage', { due_date: '', due_mileage: '' }],
      ['a negative mileage', { due_mileage: '-1' }],
      ['a decimal mileage', { due_mileage: '1000.5' }],
      ['a mileage above the integer bound', { due_mileage: '2147483648' }],
      ['a mileage with a leading zero', { due_mileage: '01000' }],
      ['an inspection field on a service row', { station_name: 'Example station' }],
      ['an inspected_on on a service row', { inspected_on: '2026-06-15' }],
    ])('rejects %s', (_label, fields) => {
      const [result] = planVehicleDueDateRows(
        [serviceRow(1, fields)],
        MAPPING,
        context(),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
    });

    it('accepts zero and the maximum mileage, and a past due date', () => {
      const results = planVehicleDueDateRows(
        [
          serviceRow(1, { due_mileage: '0', due_date: '', external_ref: 'S-0' }),
          serviceRow(2, { due_mileage: '2147483647', due_date: '2020-01-01', external_ref: 'S-MAX' }),
        ],
        MAPPING,
        context(),
      );
      expect(results.map((r) => r.action)).toEqual([
        ImportRowAction.CREATE,
        ImportRowAction.CREATE,
      ]);
    });

    it('blocks a duplicate schedule reference per vehicle but not across vehicles', () => {
      const ctx = context({
        vehicleIdByExternalId: new Map([
          ['VEHICLE-001', 'veh-1'],
          ['VEHICLE-002', 'veh-2'],
        ]),
      });
      const results = planVehicleDueDateRows(
        [
          serviceRow(1),
          serviceRow(2, { due_date: '2027-02-01' }),
          serviceRow(3, { vehicle_external_id: 'VEHICLE-002' }),
        ],
        MAPPING,
        ctx,
      );
      expect(results.map((r) => r.action)).toEqual([
        ImportRowAction.ERROR,
        ImportRowAction.ERROR,
        ImportRowAction.CREATE,
      ]);
      expect(codes(results[0])).toContain(CANONICAL_ROW_ISSUE_CODES.NATURAL_KEY_CONFLICT);
    });

    it('blocks an unmapped SERVICE_DUE notice with the same natural key', () => {
      const [result] = planVehicleDueDateRows(
        [serviceRow(1)],
        MAPPING,
        context({ serviceNotices: [storedNotice()] }),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.NATURAL_KEY_CONFLICT);
    });

    it('skips an identical replay of an OPEN notice', () => {
      const [result] = planVehicleDueDateRows(
        [serviceRow(1)],
        MAPPING,
        context({
          dueIdByExternalId: new Map([['DUE-1', 'notice-1']]),
          serviceNotices: [storedNotice()],
        }),
      );
      expect(result.action).toBe(ImportRowAction.SKIP);
      expect(result.entity_id).toBe('notice-1');
    });

    it('updates changed due values only when update_existing is on', () => {
      const base = {
        dueIdByExternalId: new Map([['DUE-1', 'notice-1']]),
        serviceNotices: [storedNotice()],
      };
      const row = serviceRow(1, { due_date: '2027-03-01' });

      const [skipped] = planVehicleDueDateRows([row], MAPPING, context(base));
      expect(skipped.action).toBe(ImportRowAction.SKIP);
      expect(skipped.warnings.length).toBeGreaterThan(0);

      const [updated] = planVehicleDueDateRows(
        [row],
        MAPPING,
        context({
          ...base,
          options: { cutover_date: '2026-11-01', update_existing: true },
        }),
      );
      expect(updated.action).toBe(ImportRowAction.UPDATE);
      expect(updated.entity_id).toBe('notice-1');
    });

    it('cannot reopen or overwrite a locally resolved notice', () => {
      const [result] = planVehicleDueDateRows(
        [serviceRow(1)],
        MAPPING,
        context({
          dueIdByExternalId: new Map([['DUE-1', 'notice-1']]),
          serviceNotices: [storedNotice({ status: 'DONE' })],
        }),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.EVIDENCE_IMMUTABLE);
    });

    it('blocks a changed schedule reference on a mapped id', () => {
      const [result] = planVehicleDueDateRows(
        [serviceRow(1, { external_ref: 'SERVICE-002' })],
        MAPPING,
        context({
          dueIdByExternalId: new Map([['DUE-1', 'notice-1']]),
          serviceNotices: [storedNotice()],
        }),
      );
      expect(result.action).toBe(ImportRowAction.ERROR);
      expect(codes(result)).toContain(CANONICAL_ROW_ISSUE_CODES.IDENTITY_CHANGED);
    });
  });
});
