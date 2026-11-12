import type { PrismaService } from '../../src/prisma/prisma.service.js';

/** Resolves once some backend in this database waits for a lock, i.e. is queued behind a holder. */
export async function waitForBlockedLock(prisma: PrismaService): Promise<void> {
  for (let poll = 0; poll < 400; poll += 1) {
    const waiting = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting
      FROM pg_locks blocked
      JOIN pg_stat_activity backend ON backend.pid = blocked.pid
      WHERE NOT blocked.granted AND backend.datname = current_database()`;
    if (waiting[0].waiting > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no backend ever waited on the lock holder');
}
