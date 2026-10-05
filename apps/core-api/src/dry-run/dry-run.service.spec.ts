import { jest } from '@jest/globals';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { DryRunService, DryRunRollbackException } from './dry-run.service.js';
import { DryRunStorage } from './dry-run.storage.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '@prisma/client';

describe('DryRunService', () => {
  let dryRunService: DryRunService;
  let mockPrisma: {
    client: {
      $transaction: jest.Mock<
        (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>
      >;
    };
  };
  let mockTx: Prisma.TransactionClient;

  beforeEach(() => {
    mockTx = {
      customer: {
        create: jest.fn(),
      },
    } as unknown as Prisma.TransactionClient;

    mockPrisma = {
      client: {
        $transaction: jest.fn().mockImplementation(async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
          return callback(mockTx);
        }),
      },
    };

    dryRunService = new DryRunService(mockPrisma as unknown as PrismaService);
  });

  describe('executeInRollbackTransaction', () => {
    it('executes work inside DryRunStorage context with active tx and returns result with wouldChange', async () => {
      let storageWasDryRun = false;
      let storageTx: Prisma.TransactionClient | undefined;

      const result = await dryRunService.executeInRollbackTransaction(async () => {
        storageWasDryRun = DryRunStorage.isDryRun();
        storageTx = DryRunStorage.getTransactionClient();
        const collector = DryRunStorage.getCollector();
        collector?.recordChange({
          entity: 'Customer',
          id: 'cust-123',
          op: 'create',
        });
        return { id: 'cust-123', name: 'Acme Corp' };
      });

      expect(storageWasDryRun).toBe(true);
      expect(storageTx).toBe(mockTx);
      expect(result).toEqual({
        result: { id: 'cust-123', name: 'Acme Corp' },
        wouldChange: [
          {
            entity: 'Customer',
            id: 'cust-123',
            op: 'create',
          },
        ],
      });
      expect(mockPrisma.client.$transaction).toHaveBeenCalledTimes(1);
    });

    it('always rolls back by throwing DryRunRollbackException inside transaction', async () => {
      let exceptionThrownInsideTx: unknown;

      mockPrisma.client.$transaction.mockImplementation(
        async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        try {
          return await callback(mockTx);
        } catch (err) {
          exceptionThrownInsideTx = err;
          throw err;
        }
      });

      const res = await dryRunService.executeInRollbackTransaction(async () => {
        return 'test-ok';
      });

      expect(res.result).toBe('test-ok');
      expect(exceptionThrownInsideTx).toBeInstanceOf(DryRunRollbackException);
      expect((exceptionThrownInsideTx as DryRunRollbackException).result).toBe('test-ok');
    });

    it('re-throws non-rollback errors thrown by work and lets transaction abort', async () => {
      const conflictError = new ConflictException('Email already in use');

      await expect(
        dryRunService.executeInRollbackTransaction(async () => {
          throw conflictError;
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws BadRequestException without swallowing it', async () => {
      const badRequest = new BadRequestException('Validation failed');

      await expect(
        dryRunService.executeInRollbackTransaction(async () => {
          throw badRequest;
        }),
      ).rejects.toThrow(badRequest);
    });

    it('falls back to prisma.$transaction if prisma.client is not defined', async () => {
      const mockPrismaDirect = {
        $transaction: jest.fn().mockImplementation(
          async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
            return callback(mockTx);
          },
        ),
      };
      const directService = new DryRunService(mockPrismaDirect as unknown as PrismaService);

      const result = await directService.executeInRollbackTransaction(async () => {
        return { direct: true };
      });

      expect(result.result).toEqual({ direct: true });
      expect(mockPrismaDirect.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
