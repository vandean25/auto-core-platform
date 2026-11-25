import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  LocationType,
  StockAdjustmentReason,
  TransactionType,
} from '@prisma/client';
import { InventoryItemMutationsService } from './inventory-item-mutations.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LedgerService } from './ledger.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { InventoryValuationService } from './inventory-valuation.service.js';

describe('InventoryItemMutationsService', () => {
  let service: InventoryItemMutationsService;
  const ledgerService = { recordTransactions: jest.fn() };
  const auditService = { recordTenantMutation: jest.fn() };
  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue('tenant-1'),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'ADMIN' }),
  };
  const siteContext = {
    listAuthorizedSiteIds: jest.fn().mockResolvedValue(['site-1']),
  };
  const valuationService = {
    resolveLastEk: jest.fn().mockResolvedValue(null),
  };
  const tx = {
    catalogItem: {
      update: jest.fn(),
    },
    storageLocation: {
      findFirst: jest.fn(),
    },
    site: {
      findFirst: jest.fn(),
    },
    inventoryValuation: {
      findFirst: jest.fn(),
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
    user: { findFirst: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    tenantContext.getAuthenticatedUser.mockReturnValue({ role: 'ADMIN' });
    siteContext.listAuthorizedSiteIds.mockResolvedValue(['site-1']);
    valuationService.resolveLastEk.mockResolvedValue(null);
    tx.storageLocation.findFirst.mockResolvedValue({
      id: 'loc-1',
      site_id: 'site-1',
      type: LocationType.bin,
      name: 'Bin 1',
    });
    tx.site.findFirst.mockResolvedValue({ legal_entity_id: 'le-1' });
    tx.inventoryValuation.findFirst.mockResolvedValue({
      average_unit_cost: '10.0000',
    });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryItemMutationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: LedgerService, useValue: ledgerService },
        { provide: AuditService, useValue: auditService },
        { provide: TenantContextService, useValue: tenantContext },
        { provide: SiteContextService, useValue: siteContext },
        { provide: InventoryValuationService, useValue: valuationService },
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
      reason: StockAdjustmentReason.INVENTORY_COUNT,
      note: ' Cycle count ',
    });

    expect(ledgerService.recordTransactions).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          type: TransactionType.ADJUSTMENT,
          referenceId: 'manual-adjustment',
          reason: StockAdjustmentReason.INVENTORY_COUNT,
          note: 'Cycle count',
        }),
      ],
      tx,
    );
    expect(auditService.recordTenantMutation).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'inventory.adjustment',
        after: expect.objectContaining({
          reason: StockAdjustmentReason.INVENTORY_COUNT,
          note: 'Cycle count',
        }),
      }),
      tx,
    );
  });

  it('rejects zero adjustment quantity', async () => {
    await expect(
      service.adjustStock('item-1', {
        locationId: 'loc-1',
        quantity: 0,
        reason: StockAdjustmentReason.INVENTORY_COUNT,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects OTHER adjustment reason when note is blank after trim', async () => {
    await expect(
      service.adjustStock('item-1', {
        locationId: 'loc-1',
        quantity: 1,
        reason: StockAdjustmentReason.OTHER,
        note: '   ',
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
      revision: BigInt(7),
      unit: 'pcs',
      revenue_group_id: null,
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
