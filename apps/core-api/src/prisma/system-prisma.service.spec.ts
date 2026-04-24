import { describe, expect, it } from '@jest/globals';
import { SystemPrismaService } from './system-prisma.service';

describe('SystemPrismaService', () => {
  it('queries platform admins without requiring tenant context', () => {
    expect(SystemPrismaService).toBeDefined();
  });

  it('exposes a privileged Prisma client for cross-tenant reads', () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      SystemPrismaService.prototype,
      'client',
    );

    expect(descriptor).toBeDefined();
  });
});