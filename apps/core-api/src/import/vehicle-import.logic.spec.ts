import { ImportRowAction } from '@prisma/client';
import {
  normalizeVehicleRow,
  planVehicleDryRunRow,
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
      customerExternalToEntityId: new Map(),
      vinSeenInFile: new Map([['1HGCM82633A004352', 1]]),
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
        customerExternalToEntityId: new Map(),
        vinSeenInFile: new Map(),
      },
      {},
      [],
    );
    expect(planned.action).toBe(ImportRowAction.ERROR);
    expect(planned.errors[0]?.code).toBe('IMPORT_UNKNOWN_OWNER');
  });
});
