import {
  AuditLogAction,
  ImportEntityType,
  ImportJobStatus,
  ImportRowAction,
  Prisma,
} from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import {
  ACTOR_DB_ID,
  ACTOR_EMAIL,
  JOB_ID,
  SOURCE_SYSTEM,
  TENANT_ID,
  arrangeApply,
  dryRunParams,
  importJobRecord,
  jobRowRecord,
  setupImportHarness,
} from './import.service.spec.support.js';

// Valid ISO 3779 check digit; the same VIN with position 9 changed does not validate.
const VIN = '1M8GDM9AXKP042788';
const VIN_BAD_CHECK_DIGIT = '1M8GDM9A0KP042788';

const HEADER = [
  'Fahrzeug-Nr',
  'FIN',
  'Kennzeichen',
  'Marke',
  'Modell',
  'Baujahr',
  'Kilometerstand',
  'Farbe',
  'Kunden-Nr',
  'Schlüsselnummer',
];

const MAPPING = {
  external_id: 'Fahrzeug-Nr',
  vin: 'FIN',
  plate: 'Kennzeichen',
  make: 'Marke',
  model: 'Modell',
  year: 'Baujahr',
  mileage: 'Kilometerstand',
  color: 'Farbe',
  owner_customer_external_id: 'Kunden-Nr',
  key_number: 'Schlüsselnummer',
};

const COL = {
  externalId: 0,
  vin: 1,
  plate: 2,
  make: 3,
  model: 4,
  year: 5,
  mileage: 6,
  color: 7,
  owner: 8,
  key: 9,
};

const EMPTY_ROW = HEADER.map(() => '');

function vehicleRow(overrides: Record<number, string>): string[] {
  return EMPTY_ROW.map((cell, index) => overrides[index] ?? cell);
}

function vehicleCsv(...rows: string[][]): string {
  return (
    [HEADER.join(';'), ...rows.map((cells) => cells.join(';'))].join('\n') +
    '\n'
  );
}

/** A complete, valid vehicle row. Overrides replace individual columns. */
function completeRow(
  externalId: string,
  overrides: Record<number, string> = {},
) {
  return vehicleRow({
    [COL.externalId]: externalId,
    [COL.vin]: VIN,
    [COL.plate]: 'W 12 AB',
    [COL.make]: 'VW',
    [COL.model]: 'Golf',
    [COL.year]: '2019',
    [COL.mileage]: '120 000',
    [COL.color]: 'Blau',
    [COL.owner]: 'K-1',
    [COL.key]: 'S-7',
    ...overrides,
  });
}

function storedVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'veh-1',
    make: 'VW',
    model: 'Golf',
    year: 2019,
    vin: VIN,
    plate: 'W12AB',
    mileage: 120000,
    color: 'Blau',
    key_number: 'S-7',
    customer_id: 'cust-1',
    ...overrides,
  };
}

describe('ImportService vehicle import (characterization)', () => {
  const h = setupImportHarness();

  function dryRunRows(text: string, optionsJson = {}) {
    return h.service
      .createDryRunFromUpload(
        dryRunParams(ImportEntityType.VEHICLE, text, {
          mappingJson: MAPPING,
          optionsJson,
        }),
      )
      .then(
        () => h.prisma.importJob.create.mock.calls.at(-1)![0].data.rows.create,
      );
  }

  const ownerMapping = [
    {
      entity_type: ImportEntityType.CUSTOMER,
      external_id: 'K-1',
      entity_id: 'cust-1',
    },
    {
      entity_type: ImportEntityType.VEHICLE,
      external_id: 'K-9',
      entity_id: 'veh-x',
    },
  ];

  describe('dry run', () => {
    beforeEach(() => {
      h.prisma.externalIdMapping.findMany.mockResolvedValue(ownerMapping);
    });

    it('plans a new vehicle with normalized VIN, plate, mileage and resolved owner', async () => {
      const text = vehicleCsv(
        completeRow('V-1', { [COL.vin]: ` ${VIN.toLowerCase()} ` }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        row_no: 1,
        external_id: 'V-1',
        action: ImportRowAction.CREATE,
        entity_id: null,
        warnings_json: Prisma.JsonNull,
        normalized_json: {
          make: 'VW',
          model: 'Golf',
          year: 2019,
          vin: VIN,
          plate: 'W12AB',
          mileage: 120000,
          color: 'Blau',
          key_number: 'S-7',
          customer_id: 'cust-1',
          owner_external_id_provided: true,
          external_id: 'V-1',
        },
      });
    });

    it('requires a VIN unless allow_missing_vin is set', async () => {
      const text = vehicleCsv(completeRow('V-1', { [COL.vin]: '' }));

      const [strict] = await dryRunRows(text);
      expect(strict).toMatchObject({
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: 'IMPORT_VIN_REQUIRED',
            message: 'vin is required unless allow_missing_vin is enabled',
            field: 'vin',
          },
        ],
      });

      h.prisma.importJob.create.mockClear();
      const [lenient] = await dryRunRows(text, { allow_missing_vin: true });
      expect(lenient).toMatchObject({ action: ImportRowAction.CREATE });
    });

    it('reports a malformed VIN and missing make, model and year in one row', async () => {
      const text = vehicleCsv(
        completeRow('V-1', {
          [COL.vin]: 'ABC',
          [COL.make]: '',
          [COL.model]: '',
          [COL.year]: '1899',
        }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.ERROR,
        normalized_json: Prisma.JsonNull,
        errors_json: [
          expect.objectContaining({ code: 'IMPORT_VIN_INVALID', field: 'vin' }),
          expect.objectContaining({
            code: 'IMPORT_MAKE_REQUIRED',
            field: 'make',
          }),
          expect.objectContaining({
            code: 'IMPORT_MODEL_REQUIRED',
            field: 'model',
          }),
          expect.objectContaining({
            code: 'IMPORT_YEAR_INVALID',
            field: 'year',
          }),
        ],
      });
    });

    it('imports a VIN with a bad check digit with a warning', async () => {
      const text = vehicleCsv(
        completeRow('V-1', { [COL.vin]: VIN_BAD_CHECK_DIGIT }),
      );

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.CREATE,
        warnings_json: [
          {
            code: 'IMPORT_VIN_CHECK_DIGIT',
            message:
              'vin check digit does not validate (imported with warning)',
            field: 'vin',
          },
        ],
      });
    });

    it('flags a repeated VIN in the file against the first row', async () => {
      const text = vehicleCsv(completeRow('V-1'), completeRow('V-2'));

      const [, second] = await dryRunRows(text);

      expect(second).toMatchObject({
        row_no: 2,
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: 'IMPORT_DUPLICATE_VIN_IN_FILE',
            message: 'Duplicate VIN in file (first seen on row 1)',
            field: 'vin',
          },
        ],
      });
    });

    it('rejects an owner that does not resolve, ignoring vehicle mappings', async () => {
      const text = vehicleCsv(completeRow('V-1', { [COL.owner]: 'K-9' }));

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.ERROR,
        errors_json: [
          {
            code: 'IMPORT_UNKNOWN_OWNER',
            message:
              'owner customer external_id does not resolve in this tenant',
            field: 'owner_customer_external_id',
          },
        ],
      });
    });

    it('matches an existing vehicle by VIN and skips it without update_existing', async () => {
      h.prisma.vehicle.findMany.mockResolvedValue([storedVehicle()]);
      const text = vehicleCsv(completeRow('V-9'));

      const [row] = await dryRunRows(text);

      expect(row).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'veh-1',
        warnings_json: [
          {
            code: 'IMPORT_EXISTING_NOT_UPDATED',
            message: 'Existing vehicle matched but update_existing is false',
          },
        ],
      });
    });

    it('matches by plate with a warning when the VIN is empty', async () => {
      h.prisma.vehicle.findMany.mockResolvedValue([
        storedVehicle({ vin: null, plate: 'W 12 AB' }),
      ]);
      const text = vehicleCsv(
        completeRow('V-9', { [COL.vin]: '', [COL.plate]: 'w12ab' }),
      );

      const [row] = await dryRunRows(text, { allow_missing_vin: true });

      expect(row).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'veh-1',
        warnings_json: [
          {
            code: 'IMPORT_MATCHED_BY_PLATE',
            message: 'Vehicle matched by plate because VIN is empty',
            field: 'plate',
          },
          {
            code: 'IMPORT_EXISTING_NOT_UPDATED',
            message: 'Existing vehicle matched but update_existing is false',
          },
        ],
      });
    });

    it('matches a stored plate with hyphens or dots against the normalised import plate', async () => {
      h.prisma.vehicle.findMany.mockResolvedValue([
        storedVehicle({ vin: null, plate: 'w-12.ab' }),
      ]);
      const text = vehicleCsv(
        completeRow('V-9', { [COL.vin]: '', [COL.plate]: 'W 12-AB' }),
      );

      const [row] = await dryRunRows(text, { allow_missing_vin: true });

      expect(row).toMatchObject({ entity_id: 'veh-1' });
    });

    it('updates a matched vehicle when a compared field differs under update_existing', async () => {
      h.prisma.vehicle.findMany.mockResolvedValue([
        storedVehicle({ mileage: 99000 }),
      ]);
      const text = vehicleCsv(completeRow('V-9'));

      const [row] = await dryRunRows(text, { update_existing: true });

      expect(row).toMatchObject({
        action: ImportRowAction.UPDATE,
        entity_id: 'veh-1',
      });
    });

    it('skips a matched vehicle that is identical under update_existing', async () => {
      h.prisma.vehicle.findMany.mockResolvedValue([storedVehicle()]);
      const text = vehicleCsv(completeRow('V-9'));

      const [row] = await dryRunRows(text, { update_existing: true });

      expect(row).toMatchObject({
        action: ImportRowAction.SKIP,
        entity_id: 'veh-1',
        warnings_json: Prisma.JsonNull,
      });
    });

    it('scopes the dry-run lookups to the caller tenant and source system', async () => {
      await dryRunRows(vehicleCsv(completeRow('V-1')));

      expect(h.prisma.externalIdMapping.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID, source_system: SOURCE_SYSTEM },
      });
      expect(h.prisma.vehicle.findMany).toHaveBeenCalledWith({
        where: { tenant_id: TENANT_ID },
      });
    });
  });

  describe('apply', () => {
    const createRow = (
      rowNo: number,
      externalId: string,
      normalized: Record<string, unknown>,
    ) =>
      jobRowRecord({
        row_no: rowNo,
        action: ImportRowAction.CREATE,
        external_id: externalId,
        normalized_json: { external_id: externalId, ...normalized },
      });

    const plannedFields = {
      make: 'VW',
      model: 'Golf',
      year: 2019,
      vin: VIN,
      plate: 'W12AB',
      mileage: 120000,
      color: 'Blau',
      key_number: 'S-7',
      customer_id: 'cust-1',
      owner_external_id_provided: true,
    };

    beforeEach(() => {
      h.prisma.externalIdMapping.findFirst.mockResolvedValue(null);
      h.prisma.externalIdMapping.create.mockResolvedValue({});
      h.prisma.externalIdMapping.upsert.mockResolvedValue({});
      h.prisma.customer.findFirst.mockResolvedValue({ id: 'cust-1' });
      h.prisma.vehicle.create.mockResolvedValue({
        id: 'veh-new',
        make: 'VW',
        model: 'Golf',
        year: 2019,
        vin: VIN,
        plate: 'W12AB',
        mileage: 120000,
        color: 'Blau',
        key_number: 'S-7',
        customer_id: 'cust-1',
      });
    });

    it('creates the vehicle with numeric year and mileage, its owner and an external id mapping', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.VEHICLE }),
        [createRow(1, 'V-1', plannedFields)],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.vehicle.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          make: 'VW',
          model: 'Golf',
          year: 2019,
          vin: VIN,
          plate: 'W12AB',
          plate_normalized: 'W12AB',
          mileage: 120000,
          color: 'Blau',
          key_number: 'S-7',
        },
      });
      // The owner goes through the party writer: an OWNER row from the import, then customer_id.
      expect(h.prisma.vehicleParty.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          vehicle_id: 'veh-new',
          customer_id: 'cust-1',
          role: 'OWNER',
          source: 'LEGACY_IMPORT',
        }),
      });
      expect(h.prisma.vehicle.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'veh-new', tenant_id: TENANT_ID },
        data: { customer_id: 'cust-1' },
      });
      expect(h.prisma.externalIdMapping.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: ImportEntityType.VEHICLE,
          source_system: SOURCE_SYSTEM,
          external_id: 'V-1',
          entity_id: 'veh-new',
          first_seen_import_job_id: JOB_ID,
        },
      });
    });

    it('writes a Vehicle CREATE audit entry with the new snapshot and no diff', async () => {
      arrangeApply(
        h,
        importJobRecord({ entity_type: ImportEntityType.VEHICLE }),
        [createRow(1, 'V-1', plannedFields)],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          tenant_id: TENANT_ID,
          entity_type: 'Vehicle',
          entity_id: 'veh-new',
          action: AuditLogAction.CREATE,
          actor_user_id: ACTOR_DB_ID,
          actor_email: ACTOR_EMAIL,
          actor_role: 'ADMIN',
          actor_type: 'USER',
          source: 'import',
          before: Prisma.JsonNull,
          after: {
            make: 'VW',
            model: 'Golf',
            year: 2019,
            vin: VIN,
            plate: 'W12AB',
            mileage: 120000,
            color: 'Blau',
            key_number: 'S-7',
            customer_id: 'cust-1',
            importJobId: JOB_ID,
          },
          diff: Prisma.JsonNull,
        },
      });
    });

    it('fills only empty fields of a matched vehicle under fill_empty_only and audits the diff', async () => {
      h.prisma.vehicle.findFirst.mockResolvedValue(
        storedVehicle({ mileage: null, color: null, key_number: 'OLD' }),
      );
      h.prisma.vehicle.update.mockResolvedValue(
        storedVehicle({ mileage: 120000, color: 'Blau', key_number: 'OLD' }),
      );
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.VEHICLE,
          options_json: { update_existing: true, fill_empty_only: true },
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.UPDATE,
            entity_id: 'veh-1',
            external_id: 'V-1',
            normalized_json: {
              external_id: 'V-1',
              ...plannedFields,
              key_number: 'NEW',
            },
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      expect(h.prisma.vehicle.update).toHaveBeenCalledWith({
        where: { id: 'veh-1' },
        data: { mileage: 120000, color: 'Blau' },
      });
      expect(h.prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entity_type: 'Vehicle',
          entity_id: 'veh-1',
          action: AuditLogAction.UPDATE,
          diff: {
            mileage: { before: null, after: 120000 },
            color: { before: null, after: 'Blau' },
          },
        }),
      });
    });

    it('overwrites non-empty fields without update data for the owner, which is never applied', async () => {
      h.prisma.vehicle.findFirst.mockResolvedValue(
        storedVehicle({ mileage: 99000 }),
      );
      h.prisma.vehicle.update.mockResolvedValue(
        storedVehicle({ mileage: 130000 }),
      );
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.VEHICLE,
          options_json: { update_existing: true },
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.UPDATE,
            entity_id: 'veh-1',
            external_id: 'V-1',
            normalized_json: {
              external_id: 'V-1',
              ...plannedFields,
              mileage: 130000,
              customer_id: 'cust-9',
            },
          }),
        ],
      );

      await h.service.applyJob(JOB_ID);

      // The owner flag is stripped before the update is built, so customer_id is not written.
      const { data } = h.prisma.vehicle.update.mock.calls[0][0];
      expect(data).toEqual({
        make: 'VW',
        model: 'Golf',
        year: 2019,
        vin: VIN,
        plate: 'W12AB',
        plate_normalized: 'W12AB',
        mileage: 130000,
        color: 'Blau',
        key_number: 'S-7',
      });
      expect(data).not.toHaveProperty('customer_id');
    });

    it('marks an UPDATE row ROW_STALE when the vehicle disappeared after the preview', async () => {
      h.prisma.vehicle.findFirst.mockResolvedValue(null);
      arrangeApply(
        h,
        importJobRecord({
          entity_type: ImportEntityType.VEHICLE,
          options_json: { update_existing: true },
        }),
        [
          jobRowRecord({
            row_no: 1,
            action: ImportRowAction.UPDATE,
            entity_id: 'veh-gone',
            external_id: 'V-1',
            normalized_json: { external_id: 'V-1', ...plannedFields },
          }),
        ],
      );

      const result = await h.service.applyJob(JOB_ID);

      expect(h.prisma.vehicle.update).not.toHaveBeenCalled();
      expect(h.prisma.importJobRow.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            action: ImportRowAction.ERROR,
            errors_json: [
              {
                code: IMPORT_ERROR_CODES.ROW_STALE,
                message: 'Import row plan is stale',
              },
            ],
          },
        }),
      );
      expect(result).toMatchObject({
        status: ImportJobStatus.APPLIED,
        totals: { error: 1 },
      });
    });
  });
});
