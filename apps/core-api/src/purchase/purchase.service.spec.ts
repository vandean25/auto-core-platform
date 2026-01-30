import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseService } from './purchase.service';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../inventory/ledger.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PurchaseOrderStatus, TransactionType } from '@prisma/client';

describe('PurchaseService', () => {
    let service: PurchaseService;
    let prisma: PrismaService;
    let ledger: LedgerService;

    const mockPrismaService = {
        vendor: {
            create: jest.fn(),
            findUnique: jest.fn(),
        },
        purchaseOrder: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        purchaseOrderItem: {
            update: jest.fn(),
        },
        catalogItem: {
            findMany: jest.fn(),
        },
        storageLocation: {
            findFirst: jest.fn(),
        },
    };

    const mockLedgerService = {
        recordTransaction: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PurchaseService,
                { provide: PrismaService, useValue: mockPrismaService },
                { provide: LedgerService, useValue: mockLedgerService },
            ],
        }).compile();

        service = module.get<PurchaseService>(PurchaseService);
        prisma = module.get<PrismaService>(PrismaService);
        ledger = module.get<LedgerService>(LedgerService);

        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('createPurchaseOrder', () => {
        it('should throw if vendor not found', async () => {
            mockPrismaService.vendor.findUnique.mockResolvedValue(null);
            await expect(service.createPurchaseOrder('v1', [])).rejects.toThrow(NotFoundException);
        });

        it('should throw if brand not supported', async () => {
            mockPrismaService.vendor.findUnique.mockResolvedValue({
                id: 'v1',
                name: 'VW Vendor',
                supported_brands: ['VW'],
            });
            mockPrismaService.catalogItem.findMany.mockResolvedValue([
                { id: 'item1', brand: 'BMW' },
            ]);

            await expect(
                service.createPurchaseOrder('v1', [{ catalogItemId: 'item1', quantity: 1, unitCost: 10 }])
            ).rejects.toThrow(BadRequestException);
        });

        it('should create PO if brand supported', async () => {
            mockPrismaService.vendor.findUnique.mockResolvedValue({
                id: 'v1',
                name: 'VW Vendor',
                supported_brands: ['VW'],
            });
            mockPrismaService.catalogItem.findMany.mockResolvedValue([
                { id: 'item1', brand: 'VW' },
            ]);
            mockPrismaService.purchaseOrder.create.mockResolvedValue({
                id: 'po1',
                order_number: 'PO-2024-001',
                status: PurchaseOrderStatus.DRAFT,
            });

            const result = await service.createPurchaseOrder('v1', [{ catalogItemId: 'item1', quantity: 1, unitCost: 10 }]);
            expect(result.id).toBe('po1');
            expect(mockPrismaService.purchaseOrder.create).toHaveBeenCalled();
        });
    });

    describe('receiveItems', () => {
        it('should receive items and record ledger transaction', async () => {
            const mockPO = {
                id: 'order1',
                order_number: 'PO-1',
                status: PurchaseOrderStatus.SENT,
                items: [
                    { id: 'poi1', catalog_item_id: 'item1', quantity: 10, quantity_received: 0, unit_cost: 50 },
                ],
            };

            mockPrismaService.purchaseOrder.findUnique.mockResolvedValue(mockPO);
            mockPrismaService.storageLocation.findFirst.mockResolvedValue({ id: 'loc1', type: 'warehouse' });
            mockPrismaService.purchaseOrderItem.update.mockResolvedValue({});
            mockPrismaService.purchaseOrder.update.mockResolvedValue({});

            await service.receiveItems('order1', [{ itemId: 'item1', quantity: 5 }]);

            expect(mockPrismaService.purchaseOrderItem.update).toHaveBeenCalledWith({
                where: { id: 'poi1' },
                data: { quantity_received: { increment: 5 } },
            });

            expect(mockLedgerService.recordTransaction).toHaveBeenCalledWith(expect.objectContaining({
                itemId: 'item1',
                quantity: 5,
                type: TransactionType.PURCHASE_RECEIPT,
                costBasis: 50,
            }));
        });
    });
});
