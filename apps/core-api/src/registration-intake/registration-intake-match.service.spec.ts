import type { PrismaService } from '../prisma/prisma.service.js';
import { RegistrationIntakeMatchService } from './registration-intake-match.service.js';
import type { RegistrationFieldEvidence } from './registration-document-extraction.types.js';

const TENANT_ID = 'tenant-1';

type CustomerRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
};

function buildPrisma(rows: CustomerRow[]) {
  return {
    customer: { findMany: jest.fn().mockResolvedValue(rows) },
    vehicle: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

function holderEvidence(
  firstName: string,
  lastName: string,
): Record<string, RegistrationFieldEvidence> {
  return {
    holder: {
      raw: `${firstName} ${lastName}`,
      normalized: { firstName, lastName },
      source: null,
      uncertainty: null,
    },
  };
}

describe('RegistrationIntakeMatchService.buildMatchSnapshot', () => {
  it('reports an existing customer whose name matches case-insensitively', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([
      { id: 'customer-1', first_name: 'Max', last_name: 'Musterfrau' },
    ]);

    const snapshot = await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('max', 'musterfrau'),
      [],
    );

    expect(snapshot.cases).toContain('EXISTING_CUSTOMER');
    expect(snapshot.customers).toEqual([
      { id: 'customer-1', firstName: 'Max', lastName: 'Musterfrau' },
    ]);
  });

  it('reports no customer when the name differs', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([
      { id: 'customer-1', first_name: 'Moritz Beispiel', last_name: 'Musterfrau' },
    ]);

    const snapshot = await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('Max', 'Mustermann'),
      [],
    );

    expect(snapshot.cases).not.toContain('EXISTING_CUSTOMER');
    expect(snapshot.customers).toEqual([]);
  });

  it('searches the customer by the name of the document holder', async () => {
    const service = new RegistrationIntakeMatchService();
    const prisma = buildPrisma([]);

    await service.buildMatchSnapshot(
      prisma,
      TENANT_ID,
      holderEvidence('Max', 'Mustermann'),
      [],
    );

    expect(prisma.customer.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        first_name: { equals: 'Max', mode: 'insensitive' },
        last_name: { equals: 'Mustermann', mode: 'insensitive' },
      },
      take: 25,
      select: { id: true, first_name: true, last_name: true },
    });
  });
});

type VehicleRow = {
  id: string;
  vin: string | null;
  plate: string | null;
  customer_id: string | null;
  national_code: string | null;
  first_registration_date: Date | null;
  co2_wltp_g_km: number | null;
  co2_nedc_g_km: number | null;
};

const VEHICLE_SELECT = {
  id: true,
  vin: true,
  plate: true,
  customer_id: true,
  national_code: true,
  first_registration_date: true,
  co2_wltp_g_km: true,
  co2_nedc_g_km: true,
};

function vehicleRow(overrides: Partial<VehicleRow> = {}): VehicleRow {
  return {
    id: 'vehicle-1',
    vin: 'WVWZZZ1JZXW000001',
    plate: 'W-12345A',
    customer_id: null,
    national_code: null,
    first_registration_date: null,
    co2_wltp_g_km: null,
    co2_nedc_g_km: null,
    ...overrides,
  };
}

function buildPrismaWithVehicles(
  customers: CustomerRow[],
  vehicles: VehicleRow[],
) {
  return {
    customer: { findMany: jest.fn().mockResolvedValue(customers) },
    vehicle: { findMany: jest.fn().mockResolvedValue(vehicles) },
  } as unknown as PrismaService;
}

function evidence(
  normalized: RegistrationFieldEvidence['normalized'],
  extra: Partial<RegistrationFieldEvidence> = {},
): RegistrationFieldEvidence {
  return {
    raw: null,
    normalized,
    source: null,
    uncertainty: null,
    ...extra,
  };
}

async function snapshotFor(
  prisma: PrismaService,
  fields: Record<string, RegistrationFieldEvidence>,
  extraCases: string[] = [],
) {
  return new RegistrationIntakeMatchService().buildMatchSnapshot(
    prisma,
    TENANT_ID,
    fields,
    extraCases,
  );
}

describe('RegistrationIntakeMatchService.buildMatchSnapshot customer lookup', () => {
  it('does not query customers when the document has no holder', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    const snapshot = await snapshotFor(prisma, {});

    expect(prisma.customer.findMany).not.toHaveBeenCalled();
    expect(snapshot).toEqual({ customers: [], vehicles: [], cases: [] });
  });

  it('does not query customers when the holder is plain text', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    await snapshotFor(prisma, { holder: evidence('Firma Muster GmbH') });

    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('does not query customers when the holder has no last name key', async () => {
    const prisma = buildPrismaWithVehicles([], []);
    const holder = {
      firstName: 'Max',
    } as unknown as RegistrationFieldEvidence['normalized'];

    await snapshotFor(prisma, { holder: evidence(holder) });

    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('does not query customers when a holder name is blank after trimming', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    await snapshotFor(prisma, {
      holder: evidence({ firstName: 'Max', lastName: '   ' }),
    });

    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('trims the holder name before searching', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    await snapshotFor(prisma, {
      holder: evidence({ firstName: '  Max ', lastName: ' Mustermann  ' }),
    });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: TENANT_ID,
          first_name: { equals: 'Max', mode: 'insensitive' },
          last_name: { equals: 'Mustermann', mode: 'insensitive' },
        },
      }),
    );
  });

  it('keeps only the rows that fold to the same name', async () => {
    const prisma = buildPrismaWithVehicles(
      [
        { id: 'customer-1', first_name: 'Max', last_name: 'Müller' },
        { id: 'customer-2', first_name: 'Max', last_name: 'Meier' },
      ],
      [],
    );

    const snapshot = await snapshotFor(prisma, {
      holder: evidence({ firstName: 'Max', lastName: 'Mueller' }),
    });

    expect(snapshot.customers).toEqual([
      { id: 'customer-1', firstName: 'Max', lastName: 'Müller' },
    ]);
    expect(snapshot.cases).toEqual(['EXISTING_CUSTOMER']);
  });

  it('reports duplicate customers when several rows match', async () => {
    const prisma = buildPrismaWithVehicles(
      [
        { id: 'customer-1', first_name: 'Max', last_name: 'Mustermann' },
        { id: 'customer-2', first_name: 'MAX', last_name: 'MUSTERMANN' },
      ],
      [],
    );

    const snapshot = await snapshotFor(prisma, {
      holder: evidence({ firstName: 'Max', lastName: 'Mustermann' }),
    });

    expect(snapshot.customers).toHaveLength(2);
    expect(snapshot.cases).toEqual(['DUPLICATE_CUSTOMERS']);
  });
});

describe('RegistrationIntakeMatchService.buildMatchSnapshot vehicle lookup', () => {
  it('does not query vehicles without a VIN or a plate', async () => {
    const prisma = buildPrismaWithVehicles([], [vehicleRow()]);

    const snapshot = await snapshotFor(prisma, {
      vin: evidence(null),
      plate: evidence(12345),
    });

    expect(prisma.vehicle.findMany).not.toHaveBeenCalled();
    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.cases).toEqual([]);
  });

  it('searches by VIN only, even when a plate is present', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    await snapshotFor(prisma, {
      vin: evidence('WVWZZZ1JZXW000001'),
      plate: evidence('W-12345A'),
    });

    expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: { tenant_id: TENANT_ID, vin: 'WVWZZZ1JZXW000001' },
      take: 25,
      select: VEHICLE_SELECT,
    });
  });

  it('falls back to the plate when the VIN is an empty string', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    await snapshotFor(prisma, {
      vin: evidence(''),
      plate: evidence('W-12345A'),
    });

    expect(prisma.vehicle.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        plate: { equals: 'W-12345A', mode: 'insensitive' },
      },
      take: 25,
      select: VEHICLE_SELECT,
    });
  });

  it('maps a single vehicle and reports it as existing', async () => {
    const prisma = buildPrismaWithVehicles(
      [],
      [vehicleRow({ customer_id: 'customer-9' })],
    );

    const snapshot = await snapshotFor(prisma, {
      plate: evidence('W-12345A'),
    });

    expect(snapshot.vehicles).toEqual([
      {
        id: 'vehicle-1',
        vin: 'WVWZZZ1JZXW000001',
        plate: 'W-12345A',
        customerId: 'customer-9',
      },
    ]);
    expect(snapshot.cases).toEqual(['EXISTING_VEHICLE']);
  });

  it('reports duplicate vehicles and checks no conflicts', async () => {
    const prisma = buildPrismaWithVehicles(
      [],
      [
        vehicleRow({ id: 'vehicle-1', national_code: 'AAA' }),
        vehicleRow({ id: 'vehicle-2', national_code: 'AAA' }),
      ],
    );

    const snapshot = await snapshotFor(prisma, {
      vin: evidence('WVWZZZ1JZXW000001'),
      nationalcode: evidence('BBB'),
    });

    expect(snapshot.vehicles).toHaveLength(2);
    expect(snapshot.cases).toEqual(['DUPLICATE_VEHICLES']);
  });

  it('reports nothing for a vehicle search without rows', async () => {
    const prisma = buildPrismaWithVehicles([], []);

    const snapshot = await snapshotFor(prisma, {
      vin: evidence('WVWZZZ1JZXW000001'),
    });

    expect(snapshot.vehicles).toEqual([]);
    expect(snapshot.cases).toEqual([]);
  });
});

describe('RegistrationIntakeMatchService.buildMatchSnapshot vehicle conflicts', () => {
  const VIN_FIELDS = { vin: evidence('WVWZZZ1JZXW000001') };

  function conflictsFor(
    row: Partial<VehicleRow>,
    fields: Record<string, RegistrationFieldEvidence>,
  ) {
    return snapshotFor(buildPrismaWithVehicles([], [vehicleRow(row)]), {
      ...VIN_FIELDS,
      ...fields,
    }).then((snapshot) => snapshot.cases);
  }

  it('flags a differing national code', async () => {
    expect(
      await conflictsFor(
        { national_code: 'AAA' },
        { nationalcode: evidence('BBB') },
      ),
    ).toEqual(['EXISTING_VEHICLE', 'NATIONALCODE_CONFLICT']);
  });

  it('ignores a national code that matches, is missing on the document, or is missing on the vehicle', async () => {
    expect(
      await conflictsFor(
        { national_code: 'AAA' },
        { nationalcode: evidence('AAA') },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(await conflictsFor({ national_code: 'AAA' }, {})).toEqual([
      'EXISTING_VEHICLE',
    ]);
    expect(
      await conflictsFor(
        { national_code: null },
        { nationalcode: evidence('BBB') },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
  });

  it('flags a differing first registration date', async () => {
    expect(
      await conflictsFor(
        { first_registration_date: new Date('2020-05-17T00:00:00.000Z') },
        { firstRegistration: evidence('2021-05-17') },
      ),
    ).toEqual(['EXISTING_VEHICLE', 'FIRST_REGISTRATION_CONFLICT']);
  });

  it('ignores a first registration date that matches or is missing on either side', async () => {
    const stored = new Date('2020-05-17T00:00:00.000Z');
    expect(
      await conflictsFor(
        { first_registration_date: stored },
        { firstRegistration: evidence('2020-05-17') },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { first_registration_date: stored },
        { firstRegistration: evidence(null) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { first_registration_date: null },
        { firstRegistration: evidence('2020-05-17') },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
  });

  it('flags a differing WLTP value against the WLTP column only', async () => {
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 120, co2_nedc_g_km: 150 },
        { co2: evidence(150, { cycle: 'WLTP' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE', 'CO2_CONFLICT']);
  });

  it('flags a differing NEDC value against the NEDC column only', async () => {
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 150, co2_nedc_g_km: 120 },
        { co2: evidence(150, { cycle: 'NEDC' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE', 'CO2_CONFLICT']);
  });

  it('ignores CO2 values that match, are unknown on the vehicle, have no cycle, or are not numbers', async () => {
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 120 },
        { co2: evidence(120, { cycle: 'WLTP' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { co2_wltp_g_km: null },
        { co2: evidence(120, { cycle: 'WLTP' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { co2_nedc_g_km: null },
        { co2: evidence(120, { cycle: 'NEDC' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 100, co2_nedc_g_km: 100 },
        { co2: evidence(120, { cycle: null }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 100 },
        { co2: evidence('120', { cycle: 'WLTP' }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
  });

  it('ignores a CO2 cycle the provider sends outside WLTP and NEDC', async () => {
    expect(
      await conflictsFor(
        { co2_wltp_g_km: 100, co2_nedc_g_km: 100 },
        { co2: evidence(100, { cycle: 'wltp' as never }) },
      ),
    ).toEqual(['EXISTING_VEHICLE']);
  });

  it('flags a vehicle owned by another customer than the one found by name', async () => {
    const prisma = buildPrismaWithVehicles(
      [{ id: 'customer-1', first_name: 'Max', last_name: 'Mustermann' }],
      [vehicleRow({ customer_id: 'customer-2' })],
    );

    const snapshot = await snapshotFor(prisma, {
      ...VIN_FIELDS,
      holder: evidence({ firstName: 'Max', lastName: 'Mustermann' }),
    });

    expect(snapshot.cases).toEqual([
      'EXISTING_CUSTOMER',
      'EXISTING_VEHICLE',
      'OWNERSHIP_CONFLICT',
    ]);
  });

  it('ignores ownership when the owner is the found customer, the vehicle has no owner, or the name is ambiguous', async () => {
    const holder = evidence({ firstName: 'Max', lastName: 'Mustermann' });
    const one = [
      { id: 'customer-1', first_name: 'Max', last_name: 'Mustermann' },
    ];
    const two = [
      ...one,
      { id: 'customer-3', first_name: 'Max', last_name: 'Mustermann' },
    ];

    const same = await snapshotFor(
      buildPrismaWithVehicles(one, [vehicleRow({ customer_id: 'customer-1' })]),
      { ...VIN_FIELDS, holder },
    );
    const unowned = await snapshotFor(
      buildPrismaWithVehicles(one, [vehicleRow({ customer_id: null })]),
      { ...VIN_FIELDS, holder },
    );
    const ambiguous = await snapshotFor(
      buildPrismaWithVehicles(two, [vehicleRow({ customer_id: 'customer-2' })]),
      { ...VIN_FIELDS, holder },
    );

    expect(same.cases).toEqual(['EXISTING_CUSTOMER', 'EXISTING_VEHICLE']);
    expect(unowned.cases).toEqual(['EXISTING_CUSTOMER', 'EXISTING_VEHICLE']);
    expect(ambiguous.cases).toEqual([
      'DUPLICATE_CUSTOMERS',
      'EXISTING_VEHICLE',
    ]);
  });

  it('collects every conflict in check order', async () => {
    const prisma = buildPrismaWithVehicles(
      [{ id: 'customer-1', first_name: 'Max', last_name: 'Mustermann' }],
      [
        vehicleRow({
          customer_id: 'customer-2',
          national_code: 'AAA',
          first_registration_date: new Date('2020-05-17T00:00:00.000Z'),
          co2_wltp_g_km: 120,
        }),
      ],
    );

    const snapshot = await snapshotFor(prisma, {
      ...VIN_FIELDS,
      holder: evidence({ firstName: 'Max', lastName: 'Mustermann' }),
      nationalcode: evidence('BBB'),
      firstRegistration: evidence('2021-01-01'),
      co2: evidence(130, { cycle: 'WLTP' }),
    });

    expect(snapshot.cases).toEqual([
      'EXISTING_CUSTOMER',
      'EXISTING_VEHICLE',
      'NATIONALCODE_CONFLICT',
      'FIRST_REGISTRATION_CONFLICT',
      'CO2_CONFLICT',
      'OWNERSHIP_CONFLICT',
    ]);
  });
});

describe('RegistrationIntakeMatchService.buildMatchSnapshot cases', () => {
  it('keeps the extra cases first and drops duplicates', async () => {
    const prisma = buildPrismaWithVehicles(
      [{ id: 'customer-1', first_name: 'Max', last_name: 'Mustermann' }],
      [],
    );

    const snapshot = await snapshotFor(
      prisma,
      { holder: evidence({ firstName: 'Max', lastName: 'Mustermann' }) },
      ['BACK_NOT_SUPPLIED', 'EXISTING_CUSTOMER', 'BACK_NOT_SUPPLIED'],
    );

    expect(snapshot.cases).toEqual(['BACK_NOT_SUPPLIED', 'EXISTING_CUSTOMER']);
  });

  it('does not change the extra cases it was given', async () => {
    const extraCases = ['BACK_NOT_SUPPLIED'];

    await snapshotFor(
      buildPrismaWithVehicles([], [vehicleRow()]),
      { vin: evidence('WVWZZZ1JZXW000001') },
      extraCases,
    );

    expect(extraCases).toEqual(['BACK_NOT_SUPPLIED']);
  });
});
