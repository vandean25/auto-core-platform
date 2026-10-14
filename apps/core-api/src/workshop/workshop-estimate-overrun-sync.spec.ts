import { Logger } from '@nestjs/common';
import {
  AuditActorType,
  AuditLogAction,
  Prisma,
  WorkshopLineItemType,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';
import {
  recordFirstDetection,
  syncWorkshopEstimateOverrunAfterWrite,
} from './workshop-estimate-overrun-sync.js';

const WARNING: WorkshopEstimateOverrunWarning = {
  total_over_threshold: true,
  new_work_lines: false,
  approved_total_gross: '192.00',
  current_total_gross: '230.00',
  threshold_pct: '15.00',
  new_line_count: 0,
};

/** The approved estimate: one version with no lines, so any line the order gets afterwards is new. */
const APPROVED_BASELINE = {
  id: 'version-1',
  snapshot: { totals: { total_gross: '192.00' }, lines: [] },
};

const LABOR_LINE = {
  id: 'line-1',
  type: WorkshopLineItemType.LABOR,
  item_no: 'AW-01',
  description: 'Ölwechsel',
  quantity: new Prisma.Decimal('1'),
  unit_price: new Prisma.Decimal('100.00'),
  part_execution_status: null,
};

/** A PrismaService stand-in for the calls the overrun sync makes. The transaction runs its callback on `tx`. */
function prismaStub() {
  const tx = {
    workshopEstimateOverrun: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'overrun-1' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    workshopEstimateVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    workshopOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    financeSettings: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  return { prisma: client as unknown as PrismaService, client, tx };
}

describe('syncWorkshopEstimateOverrunAfterWrite', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('writes nothing for an order that has no approved estimate yet', async () => {
    const { prisma, client } = prismaStub();

    await syncWorkshopEstimateOverrunAfterWrite(prisma, 'tenant-1', 'order-1');

    expect(client.workshopEstimateVersion.findFirst).toHaveBeenCalledTimes(1);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('writes nothing while the order still matches the approved estimate', async () => {
    const { prisma, client } = prismaStub();
    client.workshopEstimateVersion.findFirst.mockResolvedValue(APPROVED_BASELINE);
    client.workshopOrder.findFirst.mockResolvedValue({ id: 'order-1', tasks: [] });

    await syncWorkshopEstimateOverrunAfterWrite(prisma, 'tenant-1', 'order-1');

    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it('records the overrun with its system audit row when a write adds a line the approved estimate does not have', async () => {
    const { prisma, client, tx } = prismaStub();
    client.workshopEstimateVersion.findFirst.mockResolvedValue(APPROVED_BASELINE);
    client.workshopOrder.findFirst.mockResolvedValue({
      id: 'order-1',
      tasks: [{ id: 'task-1', line_items: [LABOR_LINE] }],
    });

    await syncWorkshopEstimateOverrunAfterWrite(prisma, 'tenant-1', 'order-1');

    expect(tx.workshopEstimateOverrun.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            tenant_id: 'tenant-1',
            workshop_estimate_version_id: 'version-1',
            new_work_lines: true,
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entity_type: 'WorkshopEstimateOverrun',
        entity_id: 'overrun-1',
        action: AuditLogAction.CREATE,
        actor_type: AuditActorType.SYSTEM,
      }),
    });
  });

  it('logs a failed check and does not fail the write that caused it', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { prisma, client } = prismaStub();
    client.workshopEstimateVersion.findFirst.mockRejectedValue(
      new Error('connection reset'),
    );

    await expect(
      syncWorkshopEstimateOverrunAfterWrite(prisma, 'tenant-1', 'order-1'),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('connection reset'),
    );
  });
});

describe('recordFirstDetection', () => {
  it('writes the overrun record and its system audit row in one transaction', async () => {
    const { prisma, client, tx } = prismaStub();

    await recordFirstDetection(prisma, 'tenant-1', 'version-1', WARNING);

    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workshopEstimateOverrun.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({
            tenant_id: 'tenant-1',
            workshop_estimate_version_id: 'version-1',
            approved_total_gross: new Prisma.Decimal('192.00'),
            detected_total_gross: new Prisma.Decimal('230.00'),
            total_over_threshold: true,
            new_work_lines: false,
          }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenant_id: 'tenant-1',
        entity_type: 'WorkshopEstimateOverrun',
        entity_id: 'overrun-1',
        action: AuditLogAction.CREATE,
        actor_type: AuditActorType.SYSTEM,
      }),
    });
  });

  it('writes no audit row when the baseline was already recorded', async () => {
    const { prisma, tx } = prismaStub();
    tx.workshopEstimateOverrun.createMany.mockResolvedValue({ count: 0 });

    await recordFirstDetection(prisma, 'tenant-1', 'version-1', WARNING);

    expect(tx.workshopEstimateOverrun.findFirst).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('fails when the record it has just written cannot be read back', async () => {
    const { prisma, tx } = prismaStub();
    tx.workshopEstimateOverrun.findFirst.mockResolvedValue(null);

    await expect(
      recordFirstDetection(prisma, 'tenant-1', 'version-1', WARNING),
    ).rejects.toThrow('not readable');
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
