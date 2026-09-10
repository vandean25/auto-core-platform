import { ConflictException } from '@nestjs/common';
import {
  LaborPauseReason,
  type Prisma,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import type { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';
import {
  closeLaborEntryAndTransitionTask,
  completeLaborAndTask,
  ensureOrderInProgress,
  pauseReasonToTaskStatus,
  startLaborAndTransitionTask,
} from './mechanic-task-transitions';

describe('mechanic-task-transitions', () => {
  const tenantId = 'tenant-1';
  const taskId = 'task-1';
  const mechanicId = 'tech-1';

  describe('pauseReasonToTaskStatus', () => {
    it('maps WAITING_PARTS to WAITING_PARTS', () => {
      expect(pauseReasonToTaskStatus(LaborPauseReason.WAITING_PARTS)).toBe(
        WorkshopTaskStatus.WAITING_PARTS,
      );
    });

    it('maps WAITING_CUSTOMER to WAITING_CUSTOMER', () => {
      expect(pauseReasonToTaskStatus(LaborPauseReason.WAITING_CUSTOMER)).toBe(
        WorkshopTaskStatus.WAITING_CUSTOMER,
      );
    });

    it('maps SWITCHED_TO_HIGHER_PRIORITY to PAUSED', () => {
      expect(
        pauseReasonToTaskStatus(LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY),
      ).toBe(WorkshopTaskStatus.PAUSED);
    });

    it('maps OTHER to null', () => {
      expect(pauseReasonToTaskStatus(LaborPauseReason.OTHER)).toBeNull();
    });

    it('maps AUTO_SHIFT_CLOSE to null', () => {
      expect(
        pauseReasonToTaskStatus(LaborPauseReason.AUTO_SHIFT_CLOSE),
      ).toBeNull();
    });
  });

  describe('closeLaborEntryAndTransitionTask', () => {
    it('throws ConflictException when labor entry update count is 0', async () => {
      const mockTx = {
        laborEntry: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        closeLaborEntryAndTransitionTask(mockTx, {
          tenantId,
          openEntryId: 'entry-1',
          taskId,
          pauseReason: LaborPauseReason.WAITING_PARTS,
          nextTaskStatus: WorkshopTaskStatus.WAITING_PARTS,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('throws ConflictException when task update count is 0', async () => {
      const mockTx = {
        laborEntry: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        closeLaborEntryAndTransitionTask(mockTx, {
          tenantId,
          openEntryId: 'entry-1',
          taskId,
          pauseReason: LaborPauseReason.WAITING_PARTS,
          nextTaskStatus: WorkshopTaskStatus.WAITING_PARTS,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('succeeds without task update when nextTaskStatus is null', async () => {
      const mockTx = {
        laborEntry: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn(),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        closeLaborEntryAndTransitionTask(mockTx, {
          tenantId,
          openEntryId: 'entry-1',
          taskId,
          pauseReason: LaborPauseReason.OTHER,
          nextTaskStatus: null,
        }),
      ).resolves.not.toThrow();

      expect(mockTx.workshopTask.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('startLaborAndTransitionTask', () => {
    it('throws ConflictException if task transition count is 0', async () => {
      const mockTx = {
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        startLaborAndTransitionTask(mockTx, {
          tenantId,
          taskId,
          mechanicId,
          taskWasAlreadyInProgress: false,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('skips task transition update if task was already in progress', async () => {
      const mockTx = {
        workshopTask: {
          updateMany: jest.fn(),
        },
        laborEntry: {
          create: jest.fn().mockResolvedValue({ id: 'entry-1' }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        startLaborAndTransitionTask(mockTx, {
          tenantId,
          taskId,
          mechanicId,
          taskWasAlreadyInProgress: true,
        }),
      ).resolves.not.toThrow();

      expect(mockTx.workshopTask.updateMany).not.toHaveBeenCalled();
      expect(mockTx.laborEntry.create).toHaveBeenCalled();
    });
  });

  describe('ensureOrderInProgress', () => {
    it('updates parent order status to IN_PROGRESS', async () => {
      const mockTx = {
        workshopOrder: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      await ensureOrderInProgress(mockTx, tenantId, 'order-1');
      expect(mockTx.workshopOrder.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'order-1',
          tenant_id: tenantId,
          NOT: {
            status: {
              in: [
                WorkshopOrderStatus.IN_PROGRESS,
                WorkshopOrderStatus.COMPLETED,
                WorkshopOrderStatus.INVOICED,
              ],
            },
          },
        },
        data: { status: WorkshopOrderStatus.IN_PROGRESS },
      });
    });
  });

  describe('completeLaborAndTask', () => {
    it('closes labor entry if open and marks task DONE', async () => {
      const mockTx = {
        laborEntry: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        workshopOrder: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      const mockVehicleLedger = {
        completeStockPrep: jest.fn().mockResolvedValue(undefined),
      } as unknown as VehicleLedgerService;

      await completeLaborAndTask(mockTx, mockVehicleLedger, {
        tenantId,
        taskId,
        orderId: 'order-1',
        openEntryId: 'entry-1',
        allOtherTasksDone: true,
      });

      expect(mockTx.laborEntry.updateMany).toHaveBeenCalled();
      expect(mockTx.workshopTask.updateMany).toHaveBeenCalled();
      expect(mockTx.workshopOrder.updateMany).toHaveBeenCalled();
      expect(mockVehicleLedger.completeStockPrep).toHaveBeenCalledWith(
        mockTx,
        tenantId,
        'order-1',
      );
    });
  });
});
