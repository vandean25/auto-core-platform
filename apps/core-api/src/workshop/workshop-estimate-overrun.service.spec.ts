import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { WorkshopEstimateOverrunWarning } from './workshop-estimate-overrun.helpers.js';
import { WorkshopEstimateOverrunService } from './workshop-estimate-overrun.service.js';

const WARNING: WorkshopEstimateOverrunWarning = {
  total_over_threshold: true,
  new_work_lines: false,
  approved_total_gross: '192.00',
  current_total_gross: '230.00',
  threshold_pct: '15.00',
  new_line_count: 0,
};

const STORED_ROW = {
  id: 'overrun-1',
  detected_at: new Date('2026-10-12T08:00:00.000Z'),
  approved_total_gross: new Prisma.Decimal('192.00'),
  detected_total_gross: new Prisma.Decimal('230.00'),
  notified_at: null,
  notified_channel: null,
  notified_amount_gross: null,
  customer_reaction: null,
  note: null,
};

const NOTICE = {
  tenantId: 'tenant-1',
  baselineVersionId: 'version-1',
  actorUserId: 'user-1',
  channel: 'PHONE' as const,
  amountGross: '230.00',
  reaction: 'AGREED' as const,
  note: 'Telefonisch bestätigt',
};

/** A PrismaService stand-in for the overrun record reads and writes. The transaction runs its callback on `tx`. */
function prismaStub() {
  const tx = {
    workshopEstimateOverrun: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue({ id: 'overrun-1' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    workshopEstimateOverrun: {
      findFirst: jest.fn().mockResolvedValue(STORED_ROW),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const service = new WorkshopEstimateOverrunService(
    client as unknown as PrismaService,
  );
  return { client, tx, service };
}

describe('WorkshopEstimateOverrunService', () => {
  describe('observe', () => {
    it('returns the stored record with its tracking state, and writes nothing', async () => {
      const { client, service } = prismaStub();

      const view = await service.observe('tenant-1', 'version-1', WARNING);

      expect(view).toMatchObject({
        total_over_threshold: true,
        detected_at: '2026-10-12T08:00:00.000Z',
        notified_at: null,
        requires_customer_notice: true,
      });
      expect(client.$transaction).not.toHaveBeenCalled();
    });

    it('records the first detection with its audit row, then returns it', async () => {
      const { client, tx, service } = prismaStub();
      client.workshopEstimateOverrun.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(STORED_ROW);

      const view = await service.observe('tenant-1', 'version-1', WARNING);

      expect(client.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
      expect(view.detected_at).toBe('2026-10-12T08:00:00.000Z');
    });
  });

  describe('recordNotice', () => {
    it('writes the notice with its channel, amount, reaction and note, when the total is not yet told', async () => {
      const { client, service } = prismaStub();

      await service.recordNotice(NOTICE);

      expect(client.workshopEstimateOverrun.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-1',
          workshop_estimate_version_id: 'version-1',
          OR: [
            { notified_at: null },
            { notified_amount_gross: { not: new Prisma.Decimal('230.00') } },
          ],
        },
        data: {
          notified_at: expect.any(Date),
          notified_channel: 'PHONE',
          notified_by_user_id: 'user-1',
          notified_amount_gross: new Prisma.Decimal('230.00'),
          customer_reaction: 'AGREED',
          note: 'Telefonisch bestätigt',
        },
      });
    });

    it('refuses a notice for a total the customer was already told, with 409', async () => {
      const { client, service } = prismaStub();
      client.workshopEstimateOverrun.updateMany.mockResolvedValue({ count: 0 });

      const error = await service
        .recordNotice(NOTICE)
        .then(() => null, (caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OVERRUN_ALREADY_NOTIFIED',
      });
    });
  });
});
