import { Test, TestingModule } from '@nestjs/testing';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
const SWAGGER_API_RESPONSE = 'swagger/apiResponse';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { PurchaseOrderResponseDto } from './dto/purchase-order-response.dto';
import { PurchaseOrderItemResponseDto } from './dto/purchase-order-response.dto';
import { PurchaseOrderQueryBuilder } from './purchase-order-query.builder';

describe('PurchaseController', () => {
  let controller: PurchaseController;
  let service: {
    createPurchaseOrder: jest.Mock;
    receiveItems: jest.Mock;
    markAsSent: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    remove: jest.Mock;
    getPurchaseOrderItems: jest.Mock;
    getPurchaseOrderItem: jest.Mock;
    addItemsToPurchaseOrder: jest.Mock;
    updatePurchaseOrderItem: jest.Mock;
    deleteItemFromPurchaseOrder: jest.Mock;
  };

  const sampleOrder = { id: 'po-1', order_number: 'PO-2026-0001' };
  const sampleItem = { id: 'item-1', catalog_item_id: 'cat-1' };

  beforeEach(async () => {
    service = {
      createPurchaseOrder: jest.fn().mockResolvedValue(sampleOrder),
      receiveItems: jest.fn().mockResolvedValue(sampleOrder),
      markAsSent: jest.fn().mockResolvedValue(sampleOrder),
      findAll: jest.fn().mockResolvedValue({ data: [sampleOrder], total: 1 }),
      findOne: jest.fn().mockResolvedValue(sampleOrder),
      remove: jest.fn().mockResolvedValue(sampleOrder),
      getPurchaseOrderItems: jest.fn().mockResolvedValue([sampleItem]),
      getPurchaseOrderItem: jest.fn().mockResolvedValue(sampleItem),
      addItemsToPurchaseOrder: jest.fn().mockResolvedValue(sampleOrder),
      updatePurchaseOrderItem: jest.fn().mockResolvedValue(sampleOrder),
      deleteItemFromPurchaseOrder: jest.fn().mockResolvedValue(sampleOrder),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseController],
      providers: [{ provide: PurchaseService, useValue: service }],
    }).compile();

    controller = module.get<PurchaseController>(PurchaseController);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('does not override global auth guards on controller handlers', () => {
    const guardedMethods = [
      controller.createPurchaseOrder,
      controller.receiveItems,
      controller.markAsSent,
      controller.findAll,
      controller.findOne,
      controller.remove,
      controller.getPurchaseOrderItems,
      controller.getPurchaseOrderItem,
      controller.addItems,
      controller.updateItem,
      controller.deleteItem,
    ];

    for (const handler of guardedMethods) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toBeUndefined();
    }
  });

  describe('createPurchaseOrder', () => {
    it('POST /purchase-orders creates a purchase order', async () => {
      const dto = {
        vendorId: 'vendor-1',
        items: [{ catalogItemId: 'cat-1', quantity: 2, unitCost: 10 }],
      };

      const result = await controller.createPurchaseOrder(dto);

      expect(result).toEqual(sampleOrder);
      expect(service.createPurchaseOrder).toHaveBeenCalledWith(
        'vendor-1',
        dto.items,
      );
    });

    it('registers create route metadata', () => {
      expect(
        Reflect.getMetadata(PATH_METADATA, controller.createPurchaseOrder),
      ).toBe('/');
      expect(
        Reflect.getMetadata(METHOD_METADATA, controller.createPurchaseOrder),
      ).toBe(RequestMethod.POST);
    });
  });

  describe('receiveItems', () => {
    it('POST /purchase-orders/:id/receive receives items', async () => {
      const dto = { items: [{ itemId: 'item-1', quantity: 1 }] };

      const result = await controller.receiveItems('po-1', dto);

      expect(result).toEqual(sampleOrder);
      expect(service.receiveItems).toHaveBeenCalledWith('po-1', dto.items);
    });
  });

  describe('markAsSent', () => {
    it('POST /purchase-orders/:id/mark-as-sent marks order as sent', async () => {
      const result = await controller.markAsSent('po-1');

      expect(result).toEqual(sampleOrder);
      expect(service.markAsSent).toHaveBeenCalledWith('po-1');
    });
  });

  describe('findAll', () => {
    it('uses advanced query path when filters are present', async () => {
      const query = {
        status: 'DRAFT',
        search: 'PO-2026',
        page: 2,
        pageSize: 10,
        sortField: 'createdAt',
        sortDirection: 'desc' as const,
      };
      const prismaQuery = { skip: 10, take: 10, where: {} };
      const buildSpy = jest
        .spyOn(PurchaseOrderQueryBuilder, 'toPrismaQuery')
        .mockReturnValue(prismaQuery);
      const responseSpy = jest
        .spyOn(PurchaseOrderQueryBuilder, 'toPaginatedResponse')
        .mockReturnValue({
          data: [sampleOrder],
          meta: { total: 1, page: 2, pageSize: 10, pageCount: 1 },
        });

      const result = await controller.findAll(query);

      expect(buildSpy).toHaveBeenCalledWith(query);
      expect(service.findAll).toHaveBeenCalledWith(prismaQuery);
      expect(responseSpy).toHaveBeenCalledWith(
        { data: [sampleOrder], total: 1 },
        query,
      );
      expect(result.meta.page).toBe(2);
    });

    it('uses legacy list path for open/all status without other filters', async () => {
      const legacySpy = jest
        .spyOn(PurchaseOrderQueryBuilder, 'toLegacyPaginatedResponse')
        .mockReturnValue({
          data: [sampleOrder],
          meta: { total: 1, page: 1, pageSize: 1, pageCount: 1 },
        });

      const result = await controller.findAll({ status: 'open' });

      expect(service.findAll).toHaveBeenCalledWith('open');
      expect(legacySpy).toHaveBeenCalledWith({ data: [sampleOrder], total: 1 });
      expect(result.data).toEqual([sampleOrder]);
    });
  });

  describe('findOne', () => {
    it('GET /purchase-orders/:id returns a purchase order', async () => {
      const result = await controller.findOne('po-1');

      expect(result).toEqual(sampleOrder);
      expect(service.findOne).toHaveBeenCalledWith('po-1');
    });
  });

  describe('remove', () => {
    it('DELETE /purchase-orders/:id removes a purchase order', async () => {
      const result = await controller.remove('po-1');

      expect(result).toEqual(sampleOrder);
      expect(service.remove).toHaveBeenCalledWith('po-1');
    });
  });

  describe('purchase order items', () => {
    it('GET /purchase-orders/:id/items lists items', async () => {
      const result = await controller.getPurchaseOrderItems('po-1');

      expect(result).toEqual([sampleItem]);
      expect(service.getPurchaseOrderItems).toHaveBeenCalledWith('po-1');
    });

    it('GET /purchase-orders/:id/items/:itemId returns one item', async () => {
      const result = await controller.getPurchaseOrderItem('po-1', 'item-1');

      expect(result).toEqual(sampleItem);
      expect(service.getPurchaseOrderItem).toHaveBeenCalledWith(
        'po-1',
        'item-1',
      );
    });

    it('POST /purchase-orders/:id/items adds items', async () => {
      const dto = {
        items: [{ catalogItemId: 'cat-2', quantity: 1, unitCost: 5 }],
      };

      const result = await controller.addItems('po-1', dto);

      expect(result).toEqual(sampleOrder);
      expect(service.addItemsToPurchaseOrder).toHaveBeenCalledWith(
        'po-1',
        dto.items,
      );
    });

    it('PATCH /purchase-orders/:id/items/:itemId updates an item', async () => {
      const dto = { quantity: 3, unitCost: 12 };

      const result = await controller.updateItem('po-1', 'item-1', dto);

      expect(result).toEqual(sampleOrder);
      expect(service.updatePurchaseOrderItem).toHaveBeenCalledWith(
        'po-1',
        'item-1',
        dto,
      );
    });

    it('DELETE /purchase-orders/:id/items/:itemId deletes an item', async () => {
      const result = await controller.deleteItem('po-1', 'item-1');

      expect(result).toEqual(sampleOrder);
      expect(service.deleteItemFromPurchaseOrder).toHaveBeenCalledWith(
        'po-1',
        'item-1',
      );
    });
  });

  it('documents purchase order response schemas in Swagger metadata', () => {
    const createResponses = Reflect.getMetadata(
      SWAGGER_API_RESPONSE,
      controller.createPurchaseOrder,
    ) as Record<string, { type?: unknown }>;
    const itemResponses = Reflect.getMetadata(
      SWAGGER_API_RESPONSE,
      controller.getPurchaseOrderItem,
    ) as Record<string, { type?: unknown }>;

    expect(createResponses?.['201']?.type).toBe(PurchaseOrderResponseDto);
    expect(itemResponses?.['200']?.type).toBe(PurchaseOrderItemResponseDto);
  });
});
