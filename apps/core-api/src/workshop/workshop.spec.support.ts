import {
  Prisma,
  TransactionType,
  WorkshopPartLineExecutionStatus,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { LedgerService } from '../inventory/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvoicesService } from '../invoices/invoices.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';

export const mockPrisma = {
  financeSettings: {
    upsert: jest.fn(),
    update: jest.fn(),
  },
  customer: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  vehicle: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    upsert: jest.fn(),
    updateMany: jest.fn(),
  },
  workshopOrder: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  workshopSettings: {
    findFirst: jest.fn(),
    findFirstOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  workshopOpeningHour: {
    findMany: jest.fn(),
    createMany: jest.fn(),
    updateMany: jest.fn(),
  },
  workshopHoliday: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
  storageLocation: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  workshopTask: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    delete: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  catalogItem: {
    findMany: jest.fn(),
  },
  vehicleLedgerEntry: {
    findFirst: jest.fn(),
  },
  inventoryStock: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  workshopTaskLineItem: {
    deleteMany: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
    updateMany: jest.fn(),
  },
  laborOperation: {
    count: jest.fn(),
  },
  $transaction: jest.fn(),
};

export const mockInvoices = {
  createDraftInvoice: jest.fn(),
};

export const mockLedgerService = {
  recordTransactions: jest.fn(),
};

export const mockVehicleLedger = {
  append: jest.fn(),
  completeStockPrep: jest.fn(),
};

export const mockTenantContext = {
  getTenantId: jest
    .fn()
    .mockResolvedValue('00000000-0000-0000-0000-000000000001'),
  getRequiredTenantId: jest
    .fn()
    .mockReturnValue('00000000-0000-0000-0000-000000000001'),
  getAuthenticatedUser: jest.fn().mockReturnValue({
    userId: 'u-1',
    email: 'admin@example.com',
    tenantId: '00000000-0000-0000-0000-000000000001',
    role: 'ADMIN',
  }),
};

export function resetWorkshopMocks() {
  jest.clearAllMocks();
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(mockPrisma),
  );
}

export const workshopPrismaProvider = {
  provide: PrismaService,
  useValue: mockPrisma,
};
export const workshopTenantProvider = {
  provide: TenantContextService,
  useValue: mockTenantContext,
};
export const workshopInvoiceProvider = {
  provide: InvoicesService,
  useValue: mockInvoices,
};
export const workshopLedgerProvider = {
  provide: LedgerService,
  useValue: mockLedgerService,
};
export const workshopVehicleLedgerProvider = {
  provide: VehicleLedgerService,
  useValue: mockVehicleLedger,
};

export {
  Prisma,
  TransactionType,
  WorkshopPartLineExecutionStatus,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
};
