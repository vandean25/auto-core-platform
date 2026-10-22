import { ConflictException } from '@nestjs/common';
import { Prisma, VehicleRecordSource } from '@prisma/client';
import {
  addPartyInTx,
  changeMainContactInTx,
  endPartyInTx,
} from './vehicle-party.writer.js';

const ctx = { tenantId: 'tenant-1', today: '2026-11-01' };
const day = (value: string | null) =>
  value === null ? null : new Date(`${value}T00:00:00.000Z`);

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'p-1',
  tenant_id: 'tenant-1',
  vehicle_id: 'veh-1',
  customer_id: 'cust-a',
  role: 'OWNER',
  valid_from: day('2024-01-01'),
  valid_to: null,
  source: VehicleRecordSource.MANUAL,
  notes: null,
  createdAt: new Date('2024-01-01T00:00:00.000Z'),
  updatedAt: new Date('2024-01-01T00:00:00.000Z'),
  ...overrides,
});

function buildTx(rows: ReturnType<typeof row>[]) {
  return {
    vehicle: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-b' }) },
    vehicleParty: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
      create: jest
        .fn()
        .mockImplementation(({ data }) => ({ id: 'new', ...data })),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('changeMainContactInTx', () => {
  it('ends the active OWNER today and starts the new OWNER today', async () => {
    const tx = buildTx([row()]);
    // The second timeline read sees the ended owner, as it does in the database.
    tx.vehicleParty.findMany
      .mockResolvedValueOnce([row()])
      .mockResolvedValueOnce([row({ valid_to: day('2026-11-01') })]);

    await changeMainContactInTx(tx as never, ctx, 'veh-1', 'cust-b');

    expect(tx.vehicleParty.update).toHaveBeenCalledWith({
      where: { tenant_id_id: { tenant_id: 'tenant-1', id: 'p-1' } },
      data: { valid_to: day('2026-11-01') },
    });
    expect(tx.vehicleParty.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer_id: 'cust-b',
        role: 'OWNER',
        valid_from: day('2026-11-01'),
        valid_to: null,
        source: 'MANUAL',
      }),
    });
    expect(tx.vehicle.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'veh-1', tenant_id: 'tenant-1' },
      data: { customer_id: 'cust-b' },
    });
  });

  it('re-points a manual OWNER that started today instead of creating a future OWNER', async () => {
    const tx = buildTx([row({ valid_from: day('2026-11-01') })]);

    await changeMainContactInTx(tx as never, ctx, 'veh-1', 'cust-b');

    expect(tx.vehicleParty.create).not.toHaveBeenCalled();
    expect(tx.vehicleParty.update).toHaveBeenCalledWith({
      where: { tenant_id_id: { tenant_id: 'tenant-1', id: 'p-1' } },
      data: { customer_id: 'cust-b' },
    });
  });

  it('withdraws a manual OWNER that started today when the contact is cleared', async () => {
    const tx = buildTx([row({ valid_from: day('2026-11-01') })]);

    await changeMainContactInTx(tx as never, ctx, 'veh-1', null);

    expect(tx.vehicleParty.deleteMany).toHaveBeenCalledWith({
      where: { id: 'p-1', tenant_id: 'tenant-1' },
    });
    expect(tx.vehicle.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'veh-1', tenant_id: 'tenant-1' },
      data: { customer_id: null },
    });
  });

  it('refuses to rewrite an imported OWNER that started today', async () => {
    const tx = buildTx([
      row({
        valid_from: day('2026-11-01'),
        source: VehicleRecordSource.LEGACY_IMPORT,
      }),
    ]);

    await expect(
      changeMainContactInTx(tx as never, ctx, 'veh-1', 'cust-b'),
    ).rejects.toThrow(ConflictException);
    expect(tx.vehicleParty.update).not.toHaveBeenCalled();
    expect(tx.vehicleParty.deleteMany).not.toHaveBeenCalled();
  });

  it('writes no party when the active OWNER already is the customer', async () => {
    const tx = buildTx([row()]);

    await changeMainContactInTx(tx as never, ctx, 'veh-1', 'cust-a');

    expect(tx.vehicleParty.update).not.toHaveBeenCalled();
    expect(tx.vehicleParty.create).not.toHaveBeenCalled();
  });
});

describe('addPartyInTx', () => {
  it('maps a unique-index violation to the same 409 as the service check', async () => {
    const tx = buildTx([]);
    tx.vehicleParty.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      addPartyInTx(tx as never, ctx, 'veh-1', {
        customer_id: 'cust-b',
        role: 'OWNER',
        valid_from: '2026-01-01',
        valid_to: null,
        notes: null,
        source: VehicleRecordSource.MANUAL,
      }),
    ).rejects.toThrow(ConflictException);
  });
});

describe('endPartyInTx', () => {
  it('only ends an open-ended party', async () => {
    const tx = buildTx([row({ valid_to: day('2026-06-01') })]);

    await expect(
      endPartyInTx(tx as never, ctx, 'veh-1', 'p-1', '2026-11-01'),
    ).rejects.toThrow(ConflictException);
    expect(tx.vehicleParty.update).not.toHaveBeenCalled();
  });

  it('ends the party without touching the main contact', async () => {
    const tx = buildTx([row()]);

    await endPartyInTx(tx as never, ctx, 'veh-1', 'p-1', '2026-11-01');

    expect(tx.vehicleParty.update).toHaveBeenCalledWith({
      where: { tenant_id_id: { tenant_id: 'tenant-1', id: 'p-1' } },
      data: { valid_to: day('2026-11-01') },
    });
    expect(tx.vehicle.updateMany).toHaveBeenCalledTimes(1); // the lock only
  });
});
