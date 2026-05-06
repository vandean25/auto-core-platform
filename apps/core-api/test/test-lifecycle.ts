import type { INestApplication } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Gracefully shuts down a NestJS test application and disconnects Prisma.
 *
 * Call this in the `afterAll()` hook of every e2e spec. The sequence matters:
 * 1. Disconnect Prisma explicitly first to drain the connection pool.
 * 2. Close the NestJS app to stop HTTP / WebSocket servers and run OnModuleDestroy hooks.
 *
 * If `prisma` is not provided (e.g. the spec uses a file-only test fixture),
 * only `app.close()` is called.
 */
export async function teardownTestApp(
  app: INestApplication,
  prisma?: PrismaService | { $disconnect: () => Promise<void> },
): Promise<void> {
  try {
    if (prisma) {
      await prisma.$disconnect();
    }
  } finally {
    await app.close();
  }
}
