import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { SiteService } from './site.service.js';

export const TENANT_ID = '00000000-0000-0000-0000-000000000001';

export const adminUser = {
  userId: 'fb-admin',
  email: 'admin@example.com',
  tenantId: TENANT_ID,
  role: 'ADMIN',
};

export function createPrismaMock() {
  const mock = {
    legalEntity: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    site: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    siteMembership: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    tenantMember: {
      findFirst: jest.fn(),
    },
    storageLocation: {
      create: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopOpeningHour: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopHoliday: {
      deleteMany: jest.fn(),
    },
    vehicle: {
      count: jest.fn(),
    },
    inventoryStock: {
      count: jest.fn(),
    },
    stockTransfer: {
      count: jest.fn(),
    },
    fiscalRegister: {
      upsert: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  mock.$transaction.mockImplementation((callback: (tx: unknown) => unknown) =>
    callback(mock),
  );
  return mock;
}

export type SiteServiceTestHarness = {
  prisma: ReturnType<typeof createPrismaMock>;
  tenantContext: {
    getTenantId: jest.Mock;
    getAuthenticatedUser: jest.Mock;
  };
  dashboardRealtime: {
    emitSiteContextUpdated: jest.Mock;
    emitSiteAccessScopeUpdated: jest.Mock;
  };
};

export function createSiteServiceTestHarness(): SiteServiceTestHarness {
  return {
    prisma: createPrismaMock(),
    tenantContext: {
      getTenantId: jest.fn().mockResolvedValue(TENANT_ID),
      getAuthenticatedUser: jest.fn().mockReturnValue(adminUser),
    },
    dashboardRealtime: {
      emitSiteContextUpdated: jest.fn(),
      emitSiteAccessScopeUpdated: jest.fn(),
    },
  };
}

export async function compileSiteServiceModule(
  harness: SiteServiceTestHarness,
): Promise<{ module: TestingModule; service: SiteService }> {
  const module = await Test.createTestingModule({
    providers: siteServiceTestProviders(harness),
  }).compile();
  return { module, service: module.get(SiteService) };
}

export const siteServiceTestProviders = (
  harness: SiteServiceTestHarness,
) => [
  SiteService,
  { provide: PrismaService, useValue: harness.prisma },
  { provide: TenantContextService, useValue: harness.tenantContext },
  { provide: DashboardRealtimeService, useValue: harness.dashboardRealtime },
];
