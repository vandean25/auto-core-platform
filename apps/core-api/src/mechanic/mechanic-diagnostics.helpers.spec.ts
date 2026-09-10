import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  processVoiceNoteDraft,
  updateInspectionItems,
  updateTaskNotes,
} from './mechanic-diagnostics.helpers';

describe('mechanic-diagnostics.helpers', () => {
  const tenantId = 'tenant-1';
  const taskId = 'task-1';
  const mechanicId = 'tech-1';

  describe('processVoiceNoteDraft', () => {
    it('throws NotFoundException when pending draft does not exist', async () => {
      const mockTx = {
        workshopVoiceNoteDraft: {
          findFirst: jest.fn().mockResolvedValue(null),
          updateMany: jest.fn(),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        processVoiceNoteDraft(mockTx, tenantId, taskId, mechanicId, 'draft-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when draft update count is 0', async () => {
      const mockTx = {
        workshopVoiceNoteDraft: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'draft-1',
            translated_text: 'Inspection done',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        processVoiceNoteDraft(mockTx, tenantId, taskId, mechanicId, 'draft-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns translated text upon successful acceptance', async () => {
      const mockTx = {
        workshopVoiceNoteDraft: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'draft-1',
            translated_text: 'Inspection done',
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      const result = await processVoiceNoteDraft(
        mockTx,
        tenantId,
        taskId,
        mechanicId,
        'draft-1',
      );

      expect(result).toBe('Inspection done');
    });
  });

  describe('updateTaskNotes', () => {
    it('throws NotFoundException if task was not updated', async () => {
      const mockTx = {
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        updateTaskNotes(mockTx, tenantId, taskId, 'Some notes'),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates task notes successfully', async () => {
      const mockTx = {
        workshopTask: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        updateTaskNotes(mockTx, tenantId, taskId, 'Some notes'),
      ).resolves.not.toThrow();
    });
  });

  describe('updateInspectionItems', () => {
    it('throws NotFoundException when inspection not found', async () => {
      const mockTx = {
        workshopInspection: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        updateInspectionItems(mockTx, tenantId, taskId, 'insp-1', [
          { itemId: 'item-1', responseValue: 'OK' },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when any inspection item update returns count 0', async () => {
      const mockTx = {
        workshopInspection: {
          findFirst: jest.fn().mockResolvedValue({ id: 'insp-1' }),
        },
        workshopInspectionItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        updateInspectionItems(mockTx, tenantId, taskId, 'insp-1', [
          { itemId: 'missing-item', responseValue: 'OK' },
        ]),
      ).rejects.toThrow(NotFoundException);
    });

    it('updates inspection items successfully', async () => {
      const mockTx = {
        workshopInspection: {
          findFirst: jest.fn().mockResolvedValue({ id: 'insp-1' }),
        },
        workshopInspectionItem: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      } as unknown as Prisma.TransactionClient;

      await expect(
        updateInspectionItems(mockTx, tenantId, taskId, 'insp-1', [
          {
            itemId: 'item-1',
            responseValue: 'OK',
            passed: true,
            severity: 'LOW',
            notes: 'All clear',
          },
        ]),
      ).resolves.not.toThrow();
    });
  });
});
