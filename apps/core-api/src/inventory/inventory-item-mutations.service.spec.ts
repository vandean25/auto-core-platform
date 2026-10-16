import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TransactionType } from '@prisma/client';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LedgerService } from './ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';

describe('InventoryItemMutationsService', () => {
  let service: InventoryItemMutationsService;
  const ledgerService = { recordTransactions: jest.fn() };
  const auditService = { recordTenantMutation: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
  };
  const prisma = {
    $transaction: jest.fn((fn: (tx: unknown) => Promise<void>) => fn({})),
    catalogItem: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    brand: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'ADMIN' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemMutationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledgerService },
        { provide: AuditService, useValue: auditService },
        { provide: TenantContextService, useValue: tenantContext },
      ],
    }).compile();

    service = module.get(InventoryItemMutationsService);
  });

  it('rejects stock mutations for TECH role', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'TECH' });

    await expect(
      service.receiveStock('item-1', { locationId: 'loc-1', quantity: 1 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('records a manual receipt ledger entry and audit log', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue({
      id: 'item-1',
      cost_price: 5,
    });

    await service.receiveStock('item-1', { locationId: 'loc-1', quantity: 2 });

    expect(ledgerService.recordTransactions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          itemId: 'item-1',
          locationId: 'loc-1',
          quantity: 2,
          type: TransactionType.PURCHASE_RECEIPT,
        }),
      ],
      {},
    );
    expect(auditService.recordTenantMutation).toHaveBeenCalled();
  });

  it('rejects zero adjustment quantity', async () => {
    await expect(
      service.adjustStock('item-1', {
        locationId: 'loc-1',
        quantity: 0,
        reason: 'Cycle count',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
