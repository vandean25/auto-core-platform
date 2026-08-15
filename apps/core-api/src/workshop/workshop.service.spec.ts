import {
  BadRequestException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
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
import { WorkshopService } from './workshop.service';
import { InvoicesService } from '../invoices/invoices.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { VehicleLedgerService } from '../vehicle-stock/vehicle-ledger.service';

describe('WorkshopService', () => {
  let service: WorkshopService;

  const mockPrisma = {
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
      update: jest.fn(),
      updateMany: jest.fn(),
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

  const mockInvoices = {
    createDraftInvoice: jest.fn(),
  };

  const mockLedgerService = {
    recordTransactions: jest.fn(),
  };

  const mockVehicleLedger = {
    append: jest.fn(),
    completeStockPrep: jest.fn(),
  };

  const mockTenantContext = {
    getTenantId: jest
      .fn()
      .mockResolvedValue('00000000-0000-0000-0000-000000000001'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkshopService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: InvoicesService, useValue: mockInvoices },
        { provide: LedgerService, useValue: mockLedgerService },
        { provide: TenantContextService, useValue: mockTenantContext },
        { provide: VehicleLedgerService, useValue: mockVehicleLedger },
      ],
    }).compile();

    service = module.get<WorkshopService>(WorkshopService);
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((cb: (tx: any) => any) =>
      cb(mockPrisma),
    );
  });

  it('delegates invoice creation to InvoicesService', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      purpose: 'CUSTOMER_REPAIR',
    });
    mockInvoices.createDraftInvoice.mockResolvedValue({ id: 'inv-1' });

    await service.createInvoiceFromOrder('wo-1');

    expect(mockInvoices.createDraftInvoice).toHaveBeenCalledWith('wo-1');
  });

  it('rejects invoicing stock-prep workshop orders', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      purpose: 'STOCK_PREP',
    });

    await expect(service.createInvoiceFromOrder('wo-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockInvoices.createDraftInvoice).not.toHaveBeenCalled();
  });

  it('creates workshop order with generated order number', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'v-1' });
    mockPrisma.financeSettings.upsert.mockResolvedValue({ id: 1 });
    mockPrisma.financeSettings.update.mockResolvedValue({
      next_workshop_order_number: 2,
    });
    mockPrisma.workshopOrder.create.mockResolvedValue({
      id: 'wo-1',
      order_number: 'WO-2026-0001',
      status: WorkshopOrderStatus.INTAKE,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      tasks: [],
    });

    const result = await service.create({
      customerId: 'c-1',
      vehicleId: 'v-1',
      odometer: 10000,
      fuelLevel: 50,
      notes: 'Noise check',
    });

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.financeSettings.upsert).toHaveBeenCalled();
    expect(mockPrisma.workshopOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          order_number: 'WO-2026-0001',
        }),
      }),
    );
    expect(result.order_number).toBe('WO-2026-0001');
  });

  it('derives workshop order status from task updates', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.DONE },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.updateTask('wo-1', 't-1', {
      status: WorkshopTaskStatus.DONE,
    });

    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: { not: WorkshopOrderStatus.INVOICED },
      },
      data: { status: WorkshopOrderStatus.COMPLETED },
    });
  });

  it('throws not found when updating missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);
    await expect(
      service.updateTask('wo-x', 'task-x', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(NotFoundException);
  });

  it('allows task updates for completed orders even when draft invoice exists', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.COMPLETED,
        invoice: { id: 'inv-draft-1', invoice_number: null },
      },
    });
    mockPrisma.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([
      { status: WorkshopTaskStatus.DONE },
      { status: WorkshopTaskStatus.NOT_STARTED },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(
      service.updateTask('wo-1', 't-1', {
        status: WorkshopTaskStatus.NOT_STARTED,
      }),
    ).resolves.toEqual({ id: 'wo-1' });

    expect(mockPrisma.workshopTask.updateMany).toHaveBeenCalled();
  });

  it('blocks updates when workshop order status is invoiced', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.INVOICED,
        invoice: { id: 'inv-1', invoice_number: 'RE-2026-0001' },
      },
    });

    await expect(
      service.updateTask('wo-1', 't-1', { status: WorkshopTaskStatus.DONE }),
    ).rejects.toThrow(BadRequestException);

    expect(mockPrisma.workshopTask.updateMany).not.toHaveBeenCalled();
  });

  it('deletes a task and recalculates workshop order status', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.IN_PROGRESS,
        invoice: null,
      },
    });
    mockPrisma.workshopTask.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTask.findMany.mockResolvedValue([]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await expect(service.deleteTask('wo-1', 't-1')).resolves.toEqual({
      id: 'wo-1',
    });

    expect(mockPrisma.workshopTask.deleteMany).toHaveBeenCalledWith({
      where: { id: 't-1', tenant_id: '00000000-0000-0000-0000-000000000001' },
    });
    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'wo-1',
        tenant_id: '00000000-0000-0000-0000-000000000001',
        status: { not: WorkshopOrderStatus.INVOICED },
      },
      data: { status: WorkshopOrderStatus.INTAKE },
    });
  });

  it('throws not found when deleting a missing task', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue(null);

    await expect(service.deleteTask('wo-x', 'task-x')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('blocks task deletion when a linked draft invoice exists', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: {
        status: WorkshopOrderStatus.COMPLETED,
        invoice: { id: 'inv-draft-1', invoice_number: null },
      },
    });

    await expect(service.deleteTask('wo-1', 't-1')).rejects.toThrow(
      BadRequestException,
    );

    expect(mockPrisma.workshopTask.delete).not.toHaveBeenCalled();
  });

  it('persists labor metadata when replacing task line items', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.workshopTaskLineItem.createMany.mockResolvedValue({ count: 2 });
    mockPrisma.laborOperation.count.mockResolvedValue(1);
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 'wo-1' } as any);

    await service.replaceTaskLineItems('wo-1', 't-1', {
      items: [
        {
          type: WorkshopLineItemType.LABOR,
          itemNo: 'LAB-001',
          description: 'Brake labor',
          qty: 1,
          unitPrice: 120,
          laborOperationId: '550e8400-e29b-41d4-a716-446655440000',
          standardAw: 0,
          actualHours: 1.5,
          internalCostRate: 0,
        },
        {
          type: WorkshopLineItemType.PART,
          itemNo: 'PART-001',
          description: 'Pad',
          qty: 1,
          unitPrice: 90,
        },
      ],
    });

    const createManyArg =
      mockPrisma.workshopTaskLineItem.createMany.mock.calls[0]?.[0];
    const firstLineItem = createManyArg?.data?.[0];
    const secondLineItem = createManyArg?.data?.[1];
    expect(createManyArg).toBeDefined();
    expect(firstLineItem).toBeDefined();
    expect(secondLineItem).toBeDefined();
    expect(firstLineItem.labor_operation_id).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(firstLineItem.standard_aw).toEqual(new Prisma.Decimal(0));
    expect(firstLineItem.actual_hours).toEqual(new Prisma.Decimal(1.5));
    expect(firstLineItem.internal_cost_rate).toEqual(new Prisma.Decimal(0));
    expect(secondLineItem.labor_operation_id).toBeNull();
    expect(secondLineItem.standard_aw).toBeNull();
    expect(secondLineItem.actual_hours).toBeNull();
    expect(secondLineItem.internal_cost_rate).toBeNull();
    expect(secondLineItem.part_execution_status).toBe(
      WorkshopPartLineExecutionStatus.PENDING_PICK,
    );
  });

  it('returns a bad request error for invalid laborOperationId', async () => {
    mockPrisma.workshopTask.findFirst.mockResolvedValue({
      id: 't-1',
      workshop_order_id: 'wo-1',
      workshop_order: { status: WorkshopOrderStatus.IN_PROGRESS },
    });
    mockPrisma.workshopTaskLineItem.deleteMany.mockResolvedValue({ count: 1 });
    mockPrisma.laborOperation.count.mockResolvedValue(0); // Simulate missing/wrong tenant ID

    await expect(
      service.replaceTaskLineItems('wo-1', 't-1', {
        items: [
          {
            type: WorkshopLineItemType.LABOR,
            itemNo: 'LAB-INVALID',
            description: 'Invalid labor reference',
            qty: 1,
            unitPrice: 100,
            laborOperationId: '00000000-0000-0000-0000-000000000001',
            standardAw: 1,
            actualHours: 1,
            internalCostRate: 50,
          },
        ],
      }),
    ).rejects.toThrow(
      'Invalid laborOperationId: one or more labor operations were not found within this tenant scope',
    );
  });

  it('normalizes labor metadata fields in workshop order response', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      customer: { id: 'c-1' },
      vehicle: { id: 'v-1' },
      invoice: null,
      tasks: [
        {
          id: 't-1',
          status: WorkshopTaskStatus.NOT_STARTED,
          line_items: [
            {
              id: 'li-1',
              type: WorkshopLineItemType.LABOR,
              item_no: 'LAB-001',
              description: 'Brake labor',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(100),
              part_execution_status: null,
              labor_operation_id: '550e8400-e29b-41d4-a716-446655440000',
              standard_aw: new Prisma.Decimal(0),
              actual_hours: new Prisma.Decimal(1.25),
              internal_cost_rate: new Prisma.Decimal(0),
            },
            {
              id: 'li-2',
              type: WorkshopLineItemType.PART,
              item_no: 'PART-001',
              description: 'Pad',
              quantity: new Prisma.Decimal(1),
              unit_price: new Prisma.Decimal(90),
              part_execution_status:
                WorkshopPartLineExecutionStatus.PENDING_PICK,
              labor_operation_id: null,
              standard_aw: null,
              actual_hours: null,
              internal_cost_rate: null,
            },
          ],
        },
      ],
    });

    const result = await service.findOne('wo-1');
    const lineItem = result.tasks[0].lineItems[0];
    expect(lineItem.laborOperationId).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
    expect(lineItem.standardAw).toBe(0);
    expect(lineItem.actualHours).toBe(1.25);
    expect(lineItem.internalCostRate).toBe(0);

    const partLineItem = result.tasks[0].lineItems[1];
    expect(partLineItem.laborOperationId).toBeNull();
    expect(partLineItem.standardAw).toBeNull();
    expect(partLineItem.actualHours).toBeNull();
    expect(partLineItem.internalCostRate).toBeNull();
    expect(partLineItem.partExecutionStatus).toBe(
      WorkshopPartLineExecutionStatus.PENDING_PICK,
    );
  });

  it('rejects pick-parts when workshop order status is not eligible', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.COMPLETED,
      order_number: 'WO-2026-0001',
    });

    await expect(
      service.pickParts('wo-1', {
        destinationLocationId: 'dest-1',
        items: [
          {
            workshopTaskLineItemId: 'line-1',
            quantity: 1,
          },
        ],
      }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('allocates from multiple source bins and records paired ledger transfers', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        item_no: 'SKU-1',
      },
    ]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-1',
      },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        location_id: 'bin-a',
        quantity_on_hand: 2,
      },
      {
        id: 'stock-2',
        location_id: 'bin-b',
        quantity_on_hand: 3,
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [
        {
          workshopTaskLineItemId: 'line-1',
          quantity: 4,
        },
      ],
    });

    expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
    expect(mockPrisma.workshopOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'wo-1',
          status: {
            in: [WorkshopOrderStatus.INTAKE, WorkshopOrderStatus.IN_PROGRESS],
          },
        }),
        data: {
          staging_location_id: 'tote-1',
        },
      }),
    );
  });

  it('does not overcommit the same source bin across same-SKU lines in one request', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      id: 'wo-1',
      status: WorkshopOrderStatus.IN_PROGRESS,
      order_number: 'WO-2026-0001',
    });
    mockPrisma.storageLocation.findFirst.mockResolvedValue({
      id: 'tote-1',
      type: 'staging_tote',
      deletedAt: null,
    });
    mockPrisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        id: 'line-1',
        item_no: 'SKU-1',
      },
      {
        id: 'line-2',
        item_no: 'SKU-1',
      },
    ]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        sku: 'SKU-1',
      },
    ]);
    mockPrisma.inventoryStock.findMany.mockResolvedValue([
      {
        id: 'stock-1',
        location_id: 'bin-a',
        quantity_on_hand: 1,
      },
      {
        id: 'stock-2',
        location_id: 'bin-b',
        quantity_on_hand: 1,
      },
    ]);
    mockPrisma.workshopOrder.updateMany.mockResolvedValue({ count: 1 });

    await service.pickParts('wo-1', {
      destinationLocationId: 'tote-1',
      items: [
        {
          workshopTaskLineItemId: 'line-1',
          quantity: 1,
        },
        {
          workshopTaskLineItemId: 'line-2',
          quantity: 1,
        },
      ],
    });

    expect(mockLedgerService.recordTransactions).toHaveBeenCalledTimes(1);
    const recordedTransactions =
      mockLedgerService.recordTransactions.mock.calls[0]?.[0] ?? [];
    const transferOutTransactions = recordedTransactions.filter(
      (transaction: any) => transaction.type === TransactionType.TRANSFER_OUT,
    );

    expect(transferOutTransactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          locationId: 'bin-a',
          quantity: -1,
        }),
        expect.objectContaining({
          locationId: 'bin-b',
          quantity: -1,
        }),
      ]),
    );
  });
});
