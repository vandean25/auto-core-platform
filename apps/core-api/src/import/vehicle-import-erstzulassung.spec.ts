import { ImportRowAction } from '@prisma/client';
import { parseImportFirstRegistrationDate } from './import-first-registration-date.util.js';
import { normalizeVehicleRow } from './vehicle-import-normalize.row.js';
import {
  planVehicleDryRunRow,
  vehicleComparableForUpdate,
} from './vehicle-import-plan.row.js';

const mapping = {
  external_id: 'Fahrzeug-Nr',
  vin: 'FIN',
  plate: 'Kennzeichen',
  make: 'Marke',
  model: 'Modell',
  year: 'Baujahr',
  owner_customer_external_id: 'Kunden-Nr',
};

const IMPORT_FIRST_REGISTRATION_MONTH_ASSUMED =
  'IMPORT_FIRST_REGISTRATION_MONTH_ASSUMED';
const IMPORT_FIRST_REGISTRATION_DATE_INVALID =
  'IMPORT_FIRST_REGISTRATION_DATE_INVALID';
const IMPORT_FIRST_REGISTRATION_DATE_FUTURE =
  'IMPORT_FIRST_REGISTRATION_DATE_FUTURE';

describe('vehicle import Erstzulassung', () => {
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
      IMPORT_FIRST_REGISTRATION_MONTH_ASSUMED,
    );
  });

  it('errors on invalid and future dates', () => {
    expect(parseImportFirstRegistrationDate('not-a-date').issues[0]?.code).toBe(
      IMPORT_FIRST_REGISTRATION_DATE_INVALID,
    );
    expect(parseImportFirstRegistrationDate('2024-02-30').issues[0]?.code).toBe(
      IMPORT_FIRST_REGISTRATION_DATE_INVALID,
    );
    const future = parseImportFirstRegistrationDate('2099-01-01');
    expect(future.issues[0]?.code).toBe(IMPORT_FIRST_REGISTRATION_DATE_FUTURE);
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
