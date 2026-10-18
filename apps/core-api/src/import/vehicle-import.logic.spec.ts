import { ImportRowAction } from '@prisma/client';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import { parseImportFirstRegistrationDate } from './import-first-registration-date.util.js';
import {
  normalizeVehicleRow,
  planVehicleDryRunRow,
  vehicleComparableForUpdate,
} from './vehicle-import.logic.js';

const mapping = {
  external_id: 'Fahrzeug-Nr',
  vin: 'FIN',
  plate: 'Kennzeichen',
  make: 'Marke',
  model: 'Modell',
  year: 'Baujahr',
  owner_customer_external_id: 'Kunden-Nr',
};

describe('vehicle-import.logic', () => {
  it('rejects duplicate VIN within the same file', () => {
    const row = normalizeVehicleRow(
      {
        'Fahrzeug-Nr': '2',
        FIN: '1HGCM82633A004352',
        Marke: 'Make',
        Modell: 'Model',
        Baujahr: '2020',
      },
      mapping,
      {},
    ).row!;
    const context = {
      mappingByExternalId: new Map(),
      vehicleByVin: new Map(),
      vehicleByPlate: new Map(),
      vehicleById: new Map(),
      customerExternalToEntityId: new Map(),
      vinSeenInFile: new Map([['1HGCM82633A004352', 1]]),
      externalIdSeenInFile: new Map(),
    };
    const planned = planVehicleDryRunRow(2, row, context, {}, []);
    expect(planned.action).toBe(ImportRowAction.ERROR);
    expect(planned.errors[0]?.code).toBe('IMPORT_DUPLICATE_VIN_IN_FILE');
  });

  it('errors when owner customer external id is unknown', () => {
    const row = normalizeVehicleRow(
      {
        'Fahrzeug-Nr': '3',
        FIN: '1HGCM82633A004352',
        Marke: 'Make',
        Modell: 'Model',
        Baujahr: '2020',
        'Kunden-Nr': 'missing-owner',
      },
      mapping,
      {},
    ).row!;
    const planned = planVehicleDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map(),
        vehicleByVin: new Map(),
        vehicleByPlate: new Map(),
        vehicleById: new Map(),
        customerExternalToEntityId: new Map(),
        vinSeenInFile: new Map(),
        externalIdSeenInFile: new Map(),
      },
      {},
      [],
    );
    expect(planned.action).toBe(ImportRowAction.ERROR);
    expect(planned.errors[0]?.code).toBe('IMPORT_UNKNOWN_OWNER');
  });

  it('SKIPs re-import when owner cell is empty but vehicle already has an owner', () => {
    const row = normalizeVehicleRow(
      {
        'Fahrzeug-Nr': 'v-1',
        FIN: '',
        Marke: 'Make',
        Modell: 'Model',
        Baujahr: '2020',
      },
      mapping,
      { allow_missing_vin: true },
    ).row!;
    const existing = {
      make: 'Make',
      model: 'Model',
      year: 2020,
      vin: '1HGCM82633A004352',
      plate: null,
      mileage: 50000,
      color: null,
      key_number: null,
      customer_id: 'cust-1',
    };
    const planned = planVehicleDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map([['v-1', 'veh-1']]),
        vehicleByVin: new Map(),
        vehicleByPlate: new Map(),
        vehicleById: new Map([['veh-1', existing]]),
        customerExternalToEntityId: new Map(),
        vinSeenInFile: new Map(),
        externalIdSeenInFile: new Map(),
      },
      { update_existing: true },
      [],
    );
    expect(planned.action).toBe(ImportRowAction.SKIP);
    expect(vehicleComparableForUpdate(planned.normalized!)).not.toHaveProperty(
      'customer_id',
    );
  });

  it('does not plan UPDATE when empty VIN and mileage would clear stored values', () => {
    const row = normalizeVehicleRow(
      {
        'Fahrzeug-Nr': 'v-1',
        FIN: '',
        Marke: 'Make',
        Modell: 'Model',
        Baujahr: '2020',
      },
      mapping,
      { allow_missing_vin: true, update_existing: true },
    ).row!;
    const existing = {
      make: 'Make',
      model: 'Model',
      year: 2020,
      vin: '1HGCM82633A004352',
      plate: null,
      mileage: 50000,
      color: null,
      key_number: null,
      customer_id: null,
    };
    const planned = planVehicleDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map([['v-1', 'veh-1']]),
        vehicleByVin: new Map(),
        vehicleByPlate: new Map(),
        vehicleById: new Map([['veh-1', existing]]),
        customerExternalToEntityId: new Map(),
        vinSeenInFile: new Map(),
        externalIdSeenInFile: new Map(),
      },
      { update_existing: true },
      [],
    );
    expect(planned.action).toBe(ImportRowAction.SKIP);
  });

  it('plans UPDATE when mileage changes', () => {
    const mappingWithMileage = { ...mapping, mileage: 'Kilometerstand' };
    const row = normalizeVehicleRow(
      {
        'Fahrzeug-Nr': 'v-1',
        FIN: '1HGCM82633A004352',
        Marke: 'Make',
        Modell: 'Model',
        Baujahr: '2020',
        Kilometerstand: '60000',
      },
      mappingWithMileage,
      {},
    ).row!;
    const planned = planVehicleDryRunRow(
      1,
      row,
      {
        mappingByExternalId: new Map([['v-1', 'veh-1']]),
        vehicleByVin: new Map(),
        vehicleByPlate: new Map(),
        vehicleById: new Map([
          [
            'veh-1',
            {
              make: 'Make',
              model: 'Model',
              year: 2020,
              vin: '1HGCM82633A004352',
              plate: null,
              mileage: 50000,
              color: null,
              key_number: null,
              customer_id: null,
            },
          ],
        ]),
        customerExternalToEntityId: new Map(),
        vinSeenInFile: new Map(),
        externalIdSeenInFile: new Map(),
      },
      { update_existing: true },
      [],
    );
    expect(planned.action).toBe(ImportRowAction.UPDATE);
  });

  describe('first_registration_date', () => {
    it('parses DD.MM.YYYY, YYYY-MM-DD, and MM/YYYY with month warning', () => {
      expect(parseImportFirstRegistrationDate('15.03.2020').isoDate).toBe(
        '2020-03-15',
      );
      expect(parseImportFirstRegistrationDate('2020-03-15').isoDate).toBe(
        '2020-03-15',
      );
      const monthOnly = parseImportFirstRegistrationDate('03/2020');
      expect(monthOnly.isoDate).toBe('2020-03-01');
      expect(monthOnly.warnings[0]?.code).toBe(
        IMPORT_ERROR_CODES.FIRST_REGISTRATION_MONTH_ASSUMED,
      );
    });

    it('errors on invalid and future dates', () => {
      expect(
        parseImportFirstRegistrationDate('not-a-date').issues[0]?.code,
      ).toBe(IMPORT_ERROR_CODES.FIRST_REGISTRATION_DATE_INVALID);
      expect(parseImportFirstRegistrationDate('2024-02-30').issues[0]?.code).toBe(
        IMPORT_ERROR_CODES.FIRST_REGISTRATION_DATE_INVALID,
      );
      const future = parseImportFirstRegistrationDate('2099-01-01');
      expect(future.issues[0]?.code).toBe(
        IMPORT_ERROR_CODES.FIRST_REGISTRATION_DATE_FUTURE,
      );
    });

    it('includes first_registration_date in dry-run normalized output', () => {
      const mappingWithDate = {
        ...mapping,
        first_registration_date: 'Erstzulassung',
      };
      const row = normalizeVehicleRow(
        {
          'Fahrzeug-Nr': 'v-erst',
          FIN: '1HGCM82633A004352',
          Marke: 'Make',
          Modell: 'Model',
          Baujahr: '2020',
          Erstzulassung: '15.03.2020',
        },
        mappingWithDate,
        {},
      ).row!;
      const planned = planVehicleDryRunRow(
        1,
        row,
        {
          mappingByExternalId: new Map(),
          vehicleByVin: new Map(),
          vehicleByPlate: new Map(),
          vehicleById: new Map(),
          customerExternalToEntityId: new Map(),
          vinSeenInFile: new Map(),
          externalIdSeenInFile: new Map(),
        },
        {},
        [],
      );
      expect(planned.normalized?.first_registration_date).toBe('2020-03-15');
      expect(planned.action).toBe(ImportRowAction.CREATE);
    });

    it('does not plan UPDATE when blank Erstzulassung would clear stored date', () => {
      const row = normalizeVehicleRow(
        {
          'Fahrzeug-Nr': 'v-1',
          FIN: '1HGCM82633A004352',
          Marke: 'Make',
          Modell: 'Model',
          Baujahr: '2020',
          Erstzulassung: '',
        },
        { ...mapping, first_registration_date: 'Erstzulassung' },
        {},
      ).row!;
      const existing = {
        make: 'Make',
        model: 'Model',
        year: 2020,
        vin: '1HGCM82633A004352',
        plate: null,
        mileage: null,
        color: null,
        key_number: null,
        customer_id: null,
        first_registration_date: '2019-06-01',
      };
      const planned = planVehicleDryRunRow(
        1,
        row,
        {
          mappingByExternalId: new Map([['v-1', 'veh-1']]),
          vehicleByVin: new Map(),
          vehicleByPlate: new Map(),
          vehicleById: new Map([['veh-1', existing]]),
          customerExternalToEntityId: new Map(),
          vinSeenInFile: new Map(),
          externalIdSeenInFile: new Map(),
        },
        { update_existing: true },
        [],
      );
      expect(planned.action).toBe(ImportRowAction.SKIP);
      expect(vehicleComparableForUpdate(planned.normalized!)).not.toHaveProperty(
        'first_registration_date',
      );
    });

    it('plans UPDATE when Erstzulassung changes stored date', () => {
      const row = normalizeVehicleRow(
        {
          'Fahrzeug-Nr': 'v-1',
          FIN: '1HGCM82633A004352',
          Marke: 'Make',
          Modell: 'Model',
          Baujahr: '2020',
          Erstzulassung: '2020-03-15',
        },
        { ...mapping, first_registration_date: 'Erstzulassung' },
        {},
      ).row!;
      const planned = planVehicleDryRunRow(
        1,
        row,
        {
          mappingByExternalId: new Map([['v-1', 'veh-1']]),
          vehicleByVin: new Map(),
          vehicleByPlate: new Map(),
          vehicleById: new Map([
            [
              'veh-1',
              {
                make: 'Make',
                model: 'Model',
                year: 2020,
                vin: '1HGCM82633A004352',
                plate: null,
                mileage: null,
                color: null,
                key_number: null,
                customer_id: null,
                first_registration_date: '2019-06-01',
              },
            ],
          ]),
          customerExternalToEntityId: new Map(),
          vinSeenInFile: new Map(),
          externalIdSeenInFile: new Map(),
        },
        { update_existing: true },
        [],
      );
      expect(planned.action).toBe(ImportRowAction.UPDATE);
    });

    it('SKIPs update with fill_empty_only when stored Erstzulassung is set', () => {
      const row = normalizeVehicleRow(
        {
          'Fahrzeug-Nr': 'v-1',
          FIN: '1HGCM82633A004352',
          Marke: 'Make',
          Modell: 'Model',
          Baujahr: '2020',
          Erstzulassung: '2020-03-15',
        },
        { ...mapping, first_registration_date: 'Erstzulassung' },
        {},
      ).row!;
      const planned = planVehicleDryRunRow(
        1,
        row,
        {
          mappingByExternalId: new Map([['v-1', 'veh-1']]),
          vehicleByVin: new Map(),
          vehicleByPlate: new Map(),
          vehicleById: new Map([
            [
              'veh-1',
              {
                make: 'Make',
                model: 'Model',
                year: 2020,
                vin: '1HGCM82633A004352',
                plate: null,
                mileage: null,
                color: null,
                key_number: null,
                customer_id: null,
                first_registration_date: '2019-06-01',
              },
            ],
          ]),
          customerExternalToEntityId: new Map(),
          vinSeenInFile: new Map(),
          externalIdSeenInFile: new Map(),
        },
        { update_existing: true, fill_empty_only: true },
        [],
      );
      expect(planned.action).toBe(ImportRowAction.SKIP);
    });
  });
});
