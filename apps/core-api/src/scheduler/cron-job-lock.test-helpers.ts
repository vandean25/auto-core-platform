import { jest } from '@jest/globals';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';

/** Pass-through lock for unit tests that exercise cron job bodies directly. */
export function cronJobLockTestStub(): Pick<
  SystemPrismaService,
  'withCronJobLock'
> {
  return {
    withCronJobLock: jest.fn(async (_name: string, fn: () => Promise<void>) => {
      await fn();
      return true;
    }),
  };
}
