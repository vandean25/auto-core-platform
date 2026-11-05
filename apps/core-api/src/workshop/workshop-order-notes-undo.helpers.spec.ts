import { WorkshopOrderPurpose, WorkshopOrderStatus } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import { executeUndoWorkshopOrderNotes } from './workshop-order-notes-undo.helpers.js';

const persistedOrder = {
  id: 'wo-1',
  tenant_id: 'tenant-1',
  site_id: 'site-1',
  status: WorkshopOrderStatus.INTAKE,
  purpose: WorkshopOrderPurpose.CUSTOMER_REPAIR,
  notes: 'After edit',
  updatedAt: new Date('2026-11-05T12:00:00.000Z'),
};

function mockTenantContextWithRole(role: string): TenantContextService {
  return {
    getAuthenticatedUser: jest.fn().mockReturnValue({
      role,
      userId: 'user-1',
      tenantId: 'tenant-1',
    }),
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
  } as unknown as TenantContextService;
}

function buildServices(role = 'ADMIN') {
  const updatedOrder = {
    ...persistedOrder,
    notes: 'Before edit',
    updatedAt: new Date('2026-11-05T12:00:01.000Z'),
  };
  const tx = {
    workshopOrder: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(updatedOrder),
    },
  };
  const prisma = {
    workshopOrder: {
      findFirst: jest.fn().mockResolvedValue(persistedOrder),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  const services = {
    prisma,
    tenantContext: mockTenantContextWithRole(role),
    siteContext: {
      getSiteId: jest.fn().mockResolvedValue('site-1'),
      listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
    },
  } as any;
  return { services, tx, updatedOrder };
}

describe('executeUndoWorkshopOrderNotes', () => {
  it('restores the previous notes when updatedAt still matches inside one transaction', async () => {
    const { services, tx, updatedOrder } = buildServices();
    const result = await executeUndoWorkshopOrderNotes(services, 'wo-1', {
      previousNotes: 'Before edit',
      expectedUpdatedAt: persistedOrder.updatedAt.toISOString(),
    });

    expect(services.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        updatedAt: persistedOrder.updatedAt,
      },
      data: { notes: 'Before edit' },
    });
    expect(result).toBe(updatedOrder);
  });
});
