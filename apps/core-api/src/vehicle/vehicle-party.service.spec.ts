import { ForbiddenException } from '@nestjs/common';
import { VehiclePartyService } from './vehicle-party.service.js';

describe('VehiclePartyService write access', () => {
  function build(role: string | undefined) {
    const prisma = { $transaction: jest.fn() };
    const tenantContext = {
      getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      getAuthenticatedUser: jest.fn().mockReturnValue({ role }),
    };
    const service = new VehiclePartyService(
      prisma as never,
      tenantContext as never,
    );
    return { service, prisma };
  }

  it.each(['TECH', 'VIEWER', undefined])(
    'refuses to add or end a party for role %s',
    async (role) => {
      const { service, prisma } = build(role);

      await expect(
        service.add('vehicle-1', { customer_id: 'c-1', role: 'DRIVER' }),
      ).rejects.toThrow(ForbiddenException);
      await expect(service.end('vehicle-1', 'party-1', {})).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
