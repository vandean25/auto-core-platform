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
  const tx = {
    catalogItem: {
      update: jest.fn(),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
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

  it('records a manual receipt ledger entry and audit log in one transaction', async () => {
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
          referenceId: 'manual-receipt',
        }),
      ],
      tx,
    );
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'inventory.manual_receive' }),
      tx,
    );
  });

  it('records an adjustment with a stable ledger reference and audit reason', async () => {
    prisma.catalogItem.findFirst.mockResolvedValue({ id: 'item-1' });

    await service.adjustStock('item-1', {
      locationId: 'loc-1',
      quantity: -1,
      reason: ' Cycle count ',
    });

    expect(ledgerService.recordTransactions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: TransactionType.ADJUSTMENT,
          referenceId: 'manual-adjustment',
        }),
      ],
      tx,
    );
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'inventory.adjustment',
        after: expect.objectContaining({ reason: 'Cycle count' }),
      }),
      tx,
    );
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

  it('rejects blank adjustment reasons after trim', async () => {
    await expect(
      service.adjustStock('item-1', {
        locationId: 'loc-1',
        quantity: 1,
        reason: '   ',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates catalog fields and audits inside the same transaction', async () => {
    prisma.catalogItem.findFirst
      .mockResolvedValueOnce({
        id: 'item-1',
        sku: 'OLD',
        name: 'Old name',
        cost_price: 1,
        retail_price: 2,
        brand_id: null,
      })
      .mockResolvedValueOnce(null);
    tx.catalogItem.update.mockResolvedValue({
      id: 'item-1',
      sku: 'NEW',
      name: 'New name',
      cost_price: 3,
      retail_price: 4,
      brand_id: null,
    });

    await service.updateItem('item-1', {
      sku: 'NEW',
      name: 'New name',
      cost_price: 3,
      retail_price: 4,
    });

    expect(tx.catalogItem.update).toHaveBeenCalled();
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'inventory.item_edit' }),
      tx,
    );
  });
});
