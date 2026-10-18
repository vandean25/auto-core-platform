import { ImportRowAction } from '@prisma/client';
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
});
