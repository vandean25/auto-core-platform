import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DryRunStorage } from './dry-run.storage.js';
import { DryRunChangeCollector } from './dry-run-change-collector.js';
import type { WouldChangeItem } from './dry-run.types.js';

export class DryRunRollbackException extends Error {
  constructor(
    public readonly result: unknown,
    public readonly wouldChange: WouldChangeItem[],
  ) {
    super('Dry run rollback');
    this.name = 'DryRunRollbackException';
  }
}

@Injectable()
export class DryRunService {
  constructor(private readonly prisma: PrismaService) {}

  async executeInRollbackTransaction<T>(
    work: () => Promise<T>,
  ): Promise<{ result: T; wouldChange: WouldChangeItem[] }> {
    const collector = new DryRunChangeCollector();

    try {
      const client: PrismaClient =
        (this.prisma as { client?: PrismaClient }).client ?? this.prisma;

      await client.$transaction(async (tx) => {
        return DryRunStorage.run(
          { isDryRun: true, tx, collector },
          async () => {
            const result = await work();
            const wouldChange = collector.getChanges();
            throw new DryRunRollbackException(result, wouldChange);
          },
        );
      });
    } catch (error) {
      if (error instanceof DryRunRollbackException) {
        return {
          result: error.result as T,
          wouldChange: error.wouldChange,
        };
      }
      throw error;
    }

    throw new Error('Dry run failed to rollback');
  }
}
