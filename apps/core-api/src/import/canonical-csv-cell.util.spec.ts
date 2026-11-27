import { ImportEntityType, ImportRowAction, type Prisma } from '@prisma/client';
import { loadVehicleBoundMappings } from './canonical-csv-cell.util.js';
import type { ParsedCsv } from './csv-parse.util.js';
import { planVehicleDueDateDryRun } from './vehicle-due-date-import.dry-run.js';
import { planVehiclePartyDryRun } from './vehicle-party-import.dry-run.js';

const TYPE = ImportEntityType;
const input = {
  tenantId: 'tenant-a',
  sourceSystem: 'fixture',
  mapping: {
    external_id: 'id',
    vehicle_external_id: 'vehicle',
    customer_external_id: 'customer',
  },
  options: {},
};

type ParityCase = {
  type: ImportEntityType;
  plan: typeof planVehiclePartyDryRun;
  fields: string[];
  values: string[];
};

function fixturePrisma(entityType: ImportEntityType, fullLoad: boolean) {
  const mappings = [
    {
      entity_type: TYPE.VEHICLE,
      external_id: 'vehicle',
      entity_id: 'vehicle-id',
    },
    {
      entity_type: TYPE.CUSTOMER,
      external_id: 'customer',
      entity_id: 'customer-id',
    },
    { entity_type: entityType, external_id: 'mapped', entity_id: 'stored-id' },
    { entity_type: entityType, external_id: 'unused', entity_id: 'unused-id' },
  ].map((row) => ({
    ...row,
    tenant_id: input.tenantId,
    source_system: input.sourceSystem,
  }));
  mappings.push({
    ...mappings[0],
    external_id: 'other-tenant',
    entity_id: 'other-tenant-vehicle',
    tenant_id: 'tenant-b',
  });
  const findMany = jest.fn(
    async ({ where }: Prisma.ExternalIdMappingFindManyArgs) => {
      const type = where?.entity_type;
      const externalId = where?.external_id;
      const entityId = where?.entity_id;
      return mappings.filter(
        (row) =>
          (!where?.tenant_id || row.tenant_id === where.tenant_id) &&
          (!where?.source_system ||
            row.source_system === where.source_system) &&
          (typeof type === 'string'
            ? row.entity_type === type
            : Array.isArray(type?.in) && type.in.includes(row.entity_type)) &&
          (fullLoad ||
            typeof externalId !== 'object' ||
            !Array.isArray(externalId.in) ||
            externalId.in.includes(row.external_id)) &&
          (typeof entityId !== 'object' ||
            !Array.isArray(entityId.in) ||
            entityId.in.includes(row.entity_id)),
      );
    },
  );
  return {
    externalIdMapping: { findMany },
    vehicle: {
      findMany: async () => [{ id: 'vehicle-id', customer_id: 'customer-id' }],
    },
    vehicleParty: {
      findMany: jest.fn(async () => [
        {
          id: 'stored-id',
          vehicle_id: 'vehicle-id',
          customer_id: 'customer-id',
          role: 'OWNER',
          valid_from: new Date('2026-01-01'),
          valid_to: null,
          notes: null,
          source: 'LEGACY_IMPORT',
        },
      ]),
    },
    vehicleInspectionRecord: { findMany: async () => [] },
    vehicleNotice: {
      findMany: async () => [
        {
          id: 'stored-id',
          vehicle_id: 'vehicle-id',
          external_ref: 'service',
          status: 'OPEN',
          body: null,
          due_date: null,
          due_mileage: 5000,
        },
      ],
    },
  };
}

describe('vehicle-bound mapping lookups', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-02-02T12:00:00Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('deduplicates trimmed keys and queries at most 1,000 keys per type at a time', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      record: { id: ` row-${index} `, vehicle: ' veh ', customer: ' cust ' },
    }));
    rows.push(rows[0]);

    await loadVehicleBoundMappings(
      { externalIdMapping: { findMany } } as never,
      input,
      rows,
      [TYPE.CUSTOMER, TYPE.VEHICLE_PARTY],
    );

    expect(
      findMany.mock.calls.map(
        ([{ where }]: [Prisma.ExternalIdMappingFindManyArgs]) => where,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: TYPE.VEHICLE,
          external_id: { in: ['veh'] },
        }),
        expect.objectContaining({
          entity_type: TYPE.CUSTOMER,
          external_id: { in: ['cust'] },
        }),
        expect.objectContaining({
          entity_type: TYPE.VEHICLE_PARTY,
          external_id: {
            in: rows.slice(0, 1000).map(({ record }) => record.id.trim()),
          },
        }),
        expect.objectContaining({
          entity_type: TYPE.VEHICLE_PARTY,
          external_id: { in: ['row-1000'] },
        }),
      ]),
    );
    expect(findMany).toHaveBeenCalledTimes(4);
  });

  it('queries nothing for blank mapping keys', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await loadVehicleBoundMappings(
      { externalIdMapping: { findMany } } as never,
      input,
      [{ record: { id: '   ', vehicle: '' } }],
      [TYPE.VEHICLE_DUE_DATE],
    );
    expect(findMany).toHaveBeenCalledTimes(0);
  });

  it('omits a null byte key without dropping valid lookups from the same file', async () => {
    const prisma = fixturePrisma(TYPE.VEHICLE_DUE_DATE, false);
    await loadVehicleBoundMappings(
      prisma as never,
      input,
      [
        { record: { vehicle: 'vehicle' } },
        { record: { vehicle: 'key\0with-null' } },
      ],
      [TYPE.VEHICLE_DUE_DATE],
    );
    expect(
      prisma.externalIdMapping.findMany.mock.calls.map(
        ([{ where }]) => where?.external_id,
      ),
    ).toEqual([{ in: ['vehicle'] }]);
  });

  it.each<ParityCase>([
    {
      type: TYPE.VEHICLE_PARTY,
      plan: planVehiclePartyDryRun,
      fields: ['customer_external_id', 'role', 'valid_from'],
      values: [' customer ', 'OWNER', '2026-01-01'],
    },
    {
      type: TYPE.VEHICLE_DUE_DATE,
      plan: planVehicleDueDateDryRun,
      fields: ['kind', 'external_ref', 'due_mileage'],
      values: ['SERVICE', 'service', '5000'],
    },
  ])(
    'preserves $type dry-run rows against the full mapping load',
    async ({ type, plan, fields, values }: ParityCase) => {
      const headers = ['external_id', 'vehicle_external_id', ...fields];
      const parsed: ParsedCsv = {
        headers,
        rows: [
          [' mapped ', ' vehicle ', ...values],
          ['mapped', 'vehicle', ...values],
          ['unknown-vehicle', 'other-tenant', ...values],
        ],
        delimiter: ',',
        sha256: '',
      };
      const options = {
        ...input,
        mapping: Object.fromEntries(headers.map((name) => [name, name])),
        options: { cutover_date: '2026-02-01' },
      };
      const oracle = await plan(
        fixturePrisma(type, true) as never,
        options,
        parsed,
      );
      const keyed = await plan(
        fixturePrisma(type, false) as never,
        options,
        parsed,
      );
      expect(keyed).toStrictEqual(oracle);
      expect(keyed.map((row) => [row.entity_id, row.errors[0]?.code])).toEqual([
        ['stored-id', undefined],
        [null, 'IMPORT_DUPLICATE_EXTERNAL_ID_IN_FILE'],
        [null, 'IMPORT_UNKNOWN_VEHICLE'],
      ]);
    },
  );

  it('matches the full mapping load when a stored owner already has an external ID outside the file', async () => {
    const headers = [
      'external_id',
      'vehicle_external_id',
      'customer_external_id',
      'role',
      'valid_from',
    ];
    const options = {
      ...input,
      mapping: Object.fromEntries(headers.map((name) => [name, name])),
      options: { cutover_date: '2026-02-01' },
    };
    const parsed: ParsedCsv = {
      headers,
      rows: [['new-alias', 'vehicle', 'customer', 'OWNER', '2026-01-01']],
      delimiter: ',',
      sha256: '',
    };
    const oracle = await planVehiclePartyDryRun(
      fixturePrisma(TYPE.VEHICLE_PARTY, true) as never,
      options,
      parsed,
    );
    const keyed = await planVehiclePartyDryRun(
      fixturePrisma(TYPE.VEHICLE_PARTY, false) as never,
      options,
      parsed,
    );

    expect(keyed).toStrictEqual(oracle);
    expect(keyed[0]).toMatchObject({
      action: ImportRowAction.ERROR,
      normalized: null,
    });
  });

  it('looks up mapped stored parties by entity ID in tenant- and source-scoped chunks', async () => {
    const prisma = fixturePrisma(TYPE.VEHICLE_PARTY, false);
    const [owner] = await prisma.vehicleParty.findMany();
    const ids = Array.from({ length: 1001 }, (_, index) => `party-${index}`);
    prisma.vehicleParty.findMany.mockResolvedValueOnce(
      ids.map((id) => ({ ...owner, id })),
    );

    await planVehiclePartyDryRun(prisma as never, input, {
      headers: ['vehicle'],
      rows: [['vehicle']],
      delimiter: ',',
      sha256: '',
    });

    expect(
      prisma.externalIdMapping.findMany.mock.calls
        .map(([{ where }]) => where)
        .filter((where) => where?.entity_id),
    ).toEqual(
      [ids.slice(0, 1000), ids.slice(1000)].map((chunk) => ({
        tenant_id: input.tenantId,
        source_system: input.sourceSystem,
        entity_type: TYPE.VEHICLE_PARTY,
        entity_id: { in: chunk },
      })),
    );
  });

  it('only loads external IDs for rows admitted by the planning budget', async () => {
    const prisma = fixturePrisma(TYPE.VEHICLE_DUE_DATE, false);
    const headers = ['external_id', 'vehicle_external_id', 'kind'];
    await planVehicleDueDateDryRun(
      prisma as never,
      {
        ...input,
        mapping: Object.fromEntries(headers.map((name) => [name, name])),
        planBudget: { deadlineMs: 0, nowMs: () => 0, rowNoOffset: 7 },
      },
      {
        headers,
        rows: [
          ['mapped', 'vehicle', 'SERVICE'],
          ['unused', 'other-tenant', 'SERVICE'],
        ],
        delimiter: ',',
        sha256: '',
      },
    );
    expect(
      prisma.externalIdMapping.findMany.mock.calls.map(([{ where }]) => where),
    ).toEqual([
      {
        tenant_id: input.tenantId,
        source_system: input.sourceSystem,
        entity_type: TYPE.VEHICLE,
        external_id: { in: ['vehicle'] },
      },
      {
        tenant_id: input.tenantId,
        source_system: input.sourceSystem,
        entity_type: TYPE.VEHICLE_DUE_DATE,
        external_id: { in: ['mapped'] },
      },
    ]);
  });
});
