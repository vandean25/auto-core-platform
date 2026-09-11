import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  LocationType,
  PartsReservationKind,
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
  PurchaseOrderStatus,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import { AtpService } from '../inventory/atp.service';
import { PartsRequisitionService } from './parts-requisition.service';

const tenantId = 'tenant-1';
const siteId = 'site-1';
const taskId = 'task-1';
const lineId = 'line-1';
const stockId = 'stock-1';
const locationId = 'location-1';
const vendorId = 'vendor-1';

function buildTransactionClient() {
  return {
    $queryRaw: jest.fn(),
    brand: {
      findFirst: jest.fn(),
    },
    vendor: {
      findFirst: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
    },
    purchaseOrder: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    purchaseOrderItem: {
      create: jest.fn(),
    },
    partsRequisition: {
      create: jest.fn(),
      findFirst: jest.fn(),
      updateMany: jest.fn(),
    },
    partsRequisitionLine: {
      create: jest.fn(),
    },
    workshopTaskLineItem: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    workshopTask: {
      updateMany: jest.fn(),
    },
    partsReservation: {
      findMany: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    storageLocation: {
      findFirst: jest.fn(),
    },
    inventoryStock: {
      findFirst: jest.fn(),
    },
  };
}

function buildLine(overrides: Record<string, unknown> = {}) {
  return {
    id: lineId,
    tenant_id: tenantId,
    workshop_task_id: taskId,
    type: WorkshopLineItemType.PART,
    part_execution_status: WorkshopPartLineExecutionStatus.PENDING_PICK,
    item_no: 'SKU-1',
    description: 'Brake pad',
    quantity: new Prisma.Decimal('2.500'),
    catalog_item_id: 'catalog-1',
    workshop_task: {
      id: taskId,
      tenant_id: tenantId,
      workshop_order: {
        id: 'order-1',
        tenant_id: tenantId,
        order_number: 'WO-1',
        status: WorkshopOrderStatus.IN_PROGRESS,
        vehicle: {
          make: 'Toyota',
          make_brand_id: 1,
        },
        stagingLocation: {
          id: 'tote-1',
          tenant_id: tenantId,
          site_id: siteId,
          deletedAt: null,
        },
      },
    },
    ...overrides,
  };
}

function buildReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reservation-1',
    tenant_id: tenantId,
    workshop_task_line_item_id: lineId,
    quantity: new Prisma.Decimal('1.000'),
    quantity_consumed: new Prisma.Decimal('0'),
    quantity_returned: new Prisma.Decimal('0'),
    quantity_staged: new Prisma.Decimal('0'),
    kind: PartsReservationKind.ON_HAND,
    status: PartsReservationStatus.OPEN,
    ...overrides,
  };
}

describe('PartsRequisitionService', () => {
  const tenantContext = {
    getTenantId: jest.fn(),
    getAuthenticatedUser: jest.fn(),
  };
  const siteContext = { getSiteId: jest.fn() };
  const atpService = {
    reserveOnHand: jest.fn(),
  } as unknown as Pick<AtpService, 'reserveOnHand'>;
  let prisma: ReturnType<typeof buildTransactionClient> & {
    $transaction: jest.Mock;
  };
  let tx: ReturnType<typeof buildTransactionClient>;
  let service: PartsRequisitionService;

  beforeEach(() => {
    jest.clearAllMocks();
    tx = buildTransactionClient();
    prisma = Object.assign(buildTransactionClient(), {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    });
    tenantContext.getTenantId.mockResolvedValue(tenantId);
    tenantContext.getAuthenticatedUser.mockReturnValue({
      tenantId,
      role: 'ADMIN',
    });
    siteContext.getSiteId.mockResolvedValue(siteId);
    atpService.reserveOnHand.mockResolvedValue(undefined);
    tx.workshopTaskLineItem.findFirst.mockResolvedValue(buildLine());
    tx.storageLocation.findFirst.mockResolvedValue({
      id: locationId,
      tenant_id: tenantId,
      site_id: siteId,
      type: 'bin',
      deletedAt: null,
      site: { id: siteId, is_active: true },
    });
    tx.inventoryStock.findFirst.mockResolvedValue({
      id: stockId,
      tenant_id: tenantId,
      catalog_item_id: 'catalog-1',
      location_id: locationId,
    });
    tx.partsReservation.findMany.mockResolvedValue([]);
    tx.partsReservation.create.mockResolvedValue({
      ...buildReservation(),
      quantity: new Prisma.Decimal('1.500'),
      location_id: locationId,
      createdAt: new Date('2026-09-10T10:00:00.000Z'),
      updatedAt: new Date('2026-09-10T10:00:00.000Z'),
    });
    tx.workshopTask.updateMany.mockResolvedValue({ count: 1 });
    tx.$queryRaw.mockResolvedValue([]);

    service = new PartsRequisitionService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
      atpService as never,
    );
  });

  it('creates one OPEN ON_HAND Decimal reservation for the requested line and increments the task version', async () => {
    const result = await service.createOnHandReservation({
      workshopTaskLineItemId: lineId,
      quantity: 1.5,
      locationId,
    });

    expect(atpService.reserveOnHand).toHaveBeenCalledWith(
      { stockId, quantity: new Prisma.Decimal('1.5') },
      tx,
    );
    expect(tx.partsReservation.create).toHaveBeenCalledWith({
      data: {
        tenant_id: tenantId,
        workshop_task_line_item_id: lineId,
        quantity: new Prisma.Decimal('1.5'),
        kind: PartsReservationKind.ON_HAND,
        status: PartsReservationStatus.OPEN,
        location_id: locationId,
      },
    });
    expect(tx.workshopTask.updateMany).toHaveBeenCalledWith({
      where: { id: taskId, tenant_id: tenantId },
      data: { line_items_version: { increment: 1 } },
    });
    expect(result.quantity).toBe('1.5');
  });

  it('rejects allocation beyond consumed plus active demand without side effects', async () => {
    tx.partsReservation.findMany.mockResolvedValue([
      buildReservation({ quantity: new Prisma.Decimal('2.500') }),
    ]);

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 0.001,
        locationId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(atpService.reserveOnHand).not.toHaveBeenCalled();
    expect(tx.partsReservation.create).not.toHaveBeenCalled();
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });

  it('rejects allocation beyond consumed demand even when the reservation is no longer active', async () => {
    tx.partsReservation.findMany.mockResolvedValue([
      buildReservation({
        quantity: new Prisma.Decimal('2.000'),
        quantity_consumed: new Prisma.Decimal('2.000'),
        status: PartsReservationStatus.FULFILLED,
      }),
    ]);

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 0.501,
        locationId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(atpService.reserveOnHand).not.toHaveBeenCalled();
    expect(tx.partsReservation.create).not.toHaveBeenCalled();
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });

  it('does not merge a reservation with another line that has the same SKU', async () => {
    tx.partsReservation.findMany.mockResolvedValue([]);
    tx.workshopTaskLineItem.findFirst.mockResolvedValue(
      buildLine({ item_no: 'SKU-1', id: 'line-2' }),
    );
    tx.partsReservation.create.mockResolvedValue({
      ...buildReservation({ workshop_task_line_item_id: 'line-2' }),
      id: 'reservation-2',
      location_id: locationId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.createOnHandReservation({
      workshopTaskLineItemId: 'line-2',
      quantity: 1,
      locationId,
    });

    expect(tx.partsReservation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workshop_task_line_item_id: 'line-2',
      }),
    });
  });

  it('surfaces a zero-row ATP update as a conflict without creating a slice', async () => {
    atpService.reserveOnHand.mockRejectedValue(
      new ConflictException('Insufficient ATP'),
    );

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(tx.partsReservation.create).not.toHaveBeenCalled();
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });

  it('requires a bin source location through the authorization predicate', async () => {
    tx.storageLocation.findFirst.mockResolvedValue(null);

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(tx.storageLocation.findFirst).toHaveBeenCalledWith({
      where: {
        id: locationId,
        tenant_id: tenantId,
        site_id: siteId,
        deletedAt: null,
        type: LocationType.bin,
        site: { is_active: true },
      },
      select: { id: true },
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a line that is not authorized through the active site', async () => {
    tx.workshopTaskLineItem.findFirst.mockResolvedValue(null);

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects cancelled workshop lines before reserving ATP or creating a reservation', async () => {
    tx.workshopTaskLineItem.findFirst.mockImplementation(
      async ({ where }) =>
        where.part_execution_status
          ? null
          : buildLine({
              part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
            }),
    );

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);

    expect(atpService.reserveOnHand).not.toHaveBeenCalled();
    expect(tx.partsReservation.create).not.toHaveBeenCalled();
    expect(tx.workshopTask.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a TECH service context before mutation', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({
      tenantId,
      role: 'TECH',
    });

    await expect(
      service.createOnHandReservation({
        workshopTaskLineItemId: lineId,
        quantity: 1,
        locationId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects TECH access to shortage reads before querying lines', async () => {
    tenantContext.getAuthenticatedUser.mockReturnValue({
      tenantId,
      role: 'TECH',
    });

    await expect(service.getShortages({})).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    expect(prisma.workshopTaskLineItem.findMany).not.toHaveBeenCalled();
  });

  it('locks rows in task, line, reservation, then stock order', async () => {
    tx.partsReservation.findMany.mockResolvedValue([
      buildReservation({ id: 'reservation-2' }),
      buildReservation({ id: 'reservation-1' }),
    ]);

    await service.createOnHandReservation({
      workshopTaskLineItemId: lineId,
      quantity: 0.5,
      locationId,
    });

    const lockSql = tx.$queryRaw.mock.calls.map(([strings]) =>
      strings.join(' '),
    );
    expect(lockSql).toHaveLength(4);
    expect(lockSql[0]).toContain('FROM workshop_tasks');
    expect(lockSql[1]).toContain('FROM workshop_task_line_items');
    expect(lockSql[2]).toContain('FROM parts_reservations');
    expect(lockSql[3]).toContain('FROM inventory_stocks');
  });

  it('calculates shortages without resurrecting consumed demand', async () => {
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        ...buildLine(),
        quantity: new Prisma.Decimal('5.000'),
        parts_reservations: [
          buildReservation({
            quantity: new Prisma.Decimal('4.000'),
            quantity_consumed: new Prisma.Decimal('2.000'),
            quantity_staged: new Prisma.Decimal('1.000'),
          }),
          buildReservation({
            id: 'cancelled',
            quantity: new Prisma.Decimal('2.000'),
            status: PartsReservationStatus.CANCELLED,
          }),
        ],
      },
    ]);

    const result = await service.getShortages({});

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        lineQuantity: '5',
        consumedQuantity: '2',
        activeCommitment: '2',
        shortageQuantity: '1',
      }),
    );
  });

  it('returns only positive shortages and scopes shortage reads to the active site', async () => {
    prisma.workshopTaskLineItem.findMany.mockResolvedValue([
      {
        ...buildLine({
          quantity: new Prisma.Decimal('2.000'),
          workshop_task: {
            ...buildLine().workshop_task,
            workshop_order: {
              ...buildLine().workshop_task.workshop_order,
              stagingLocation: {
                id: 'tote-1',
                tenant_id: tenantId,
                site_id: siteId,
                deletedAt: null,
              },
            },
          },
        }),
        parts_reservations: [
          buildReservation({
            quantity: new Prisma.Decimal('2.000'),
            quantity_consumed: new Prisma.Decimal('2.000'),
          }),
        ],
      },
    ]);

    const result = await service.getShortages({});

    expect(result.data).toEqual([]);
      expect(prisma.workshopTaskLineItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: tenantId,
            workshop_task: expect.objectContaining({
              workshop_order: expect.objectContaining({
                site_id: siteId,
              }),
            }),
          }),
        }),
      );
    });

  describe('createRequisitionSheet', () => {
    function buildCandidateLine(makeBrandId: number) {
      return {
        id: lineId,
        workshop_task_id: taskId,
        quantity: new Prisma.Decimal('2.500'),
        workshop_task: {
          workshop_order: {
            id: 'order-1',
            order_number: 'WO-1',
            vehicle: { make_brand_id: makeBrandId },
          },
        },
      };
    }

    it('creates a DRAFT requisition with an OPEN REQUISITION slice', async () => {
      tx.brand.findFirst.mockResolvedValue({ id: 1 });
      tx.workshopTaskLineItem.findMany.mockResolvedValue([
        buildCandidateLine(1),
      ]);
      tx.partsRequisition.create.mockResolvedValue({ id: 'requisition-1' });
      tx.partsRequisitionLine.create.mockResolvedValue({
        id: 'requisition-line-1',
      });
      tx.partsRequisition.findFirst.mockResolvedValue({
        id: 'requisition-1',
        tenant_id: tenantId,
        vehicle_make_brand_id: 1,
        status: PartsRequisitionStatus.DRAFT,
        createdAt: new Date(),
        updatedAt: new Date(),
        lines: [
          {
            id: 'requisition-line-1',
            createdAt: new Date(),
            updatedAt: new Date(),
            reservation: {
              id: 'reservation-1',
              workshop_task_line_item_id: lineId,
              quantity: new Prisma.Decimal('1.500'),
              status: PartsReservationStatus.OPEN,
              purchase_order_item_id: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              workshop_task_line_item: {
                item_no: 'SKU-1',
                description: 'Brake pad',
                workshop_task: {
                  workshop_order: { id: 'order-1', order_number: 'WO-1' },
                },
              },
            },
          },
        ],
      });

      const result = await service.createRequisitionSheet({
        vehicleMakeBrandId: 1,
        items: [{ workshopTaskLineItemId: lineId, quantity: 1.5 }],
      });

      expect(tx.brand.findFirst).toHaveBeenCalledWith({
        where: {
          id: 1,
          tenant_id: tenantId,
          isVehicleMake: true,
        },
        select: { id: true },
      });
      expect(tx.partsRequisition.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          vehicle_make_brand_id: 1,
          status: PartsRequisitionStatus.DRAFT,
        },
        select: { id: true },
      });
      expect(tx.partsReservation.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          workshop_task_line_item_id: lineId,
          quantity: new Prisma.Decimal('1.5'),
          kind: PartsReservationKind.REQUISITION,
          status: PartsReservationStatus.OPEN,
          requisition_line_id: 'requisition-line-1',
        },
      });
      expect(tx.workshopTask.updateMany).toHaveBeenCalledWith({
        where: { tenant_id: tenantId, id: { in: [taskId] } },
        data: { line_items_version: { increment: 1 } },
      });
      expect(result.status).toBe(PartsRequisitionStatus.DRAFT);
      expect(result.lines).toHaveLength(1);
    });

    it('rejects a line from a different vehicle make', async () => {
      tx.brand.findFirst.mockResolvedValue({ id: 1 });
      tx.workshopTaskLineItem.findMany.mockResolvedValue([
        buildCandidateLine(2),
      ]);

      await expect(
        service.createRequisitionSheet({
          vehicleMakeBrandId: 1,
          items: [{ workshopTaskLineItemId: lineId, quantity: 1 }],
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(tx.partsReservation.create).not.toHaveBeenCalled();
    });
  });

  describe('createPurchaseOrderForRequisition', () => {
    it('creates one linked purchase order item per reservation slice', async () => {
      tx.partsRequisition.findFirst.mockResolvedValue({
        id: 'requisition-1',
        status: PartsRequisitionStatus.DRAFT,
      });
      tx.partsReservation.findMany
        .mockResolvedValueOnce([
          {
            id: 'reservation-1',
            quantity: new Prisma.Decimal('1.5'),
            status: PartsReservationStatus.OPEN,
            kind: PartsReservationKind.REQUISITION,
            purchase_order_item_id: null,
            requisition_line: { requisition_id: 'requisition-1' },
            workshop_task_line_item: {
              catalog_item_id: 'catalog-1',
              workshop_task: { workshop_order: { site_id: siteId } },
            },
          },
        ])
        .mockResolvedValue([]);
      tx.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        name: 'Vendor',
        supportedBrands: [],
      });
      tx.catalogItem.findMany.mockResolvedValue([
        { id: 'catalog-1', brand_id: null, brand: null },
      ]);
      tx.purchaseOrder.create.mockResolvedValue({ id: 'po-1' });
      tx.purchaseOrderItem.create.mockResolvedValue({ id: 'poi-1' });
      tx.partsReservation.updateMany.mockResolvedValue({ count: 1 });
      tx.purchaseOrder.findFirst.mockResolvedValue({
        id: 'po-1',
        vendor_id: vendorId,
        status: PurchaseOrderStatus.DRAFT,
        order_number: 'PO-2026-0001',
        vendor: {},
        items: [
          {
            id: 'poi-1',
            quantity: new Prisma.Decimal('1.5'),
            quantity_received: new Prisma.Decimal(0),
            unit_cost: new Prisma.Decimal('10'),
            catalog_item_id: 'catalog-1',
          },
        ],
        createdAt: new Date(),
      });

      const result = await service.createPurchaseOrderForRequisition(
        'requisition-1',
        { vendorId, items: [{ reservationId: 'reservation-1', unitCost: 10 }] },
      );

      expect(tx.purchaseOrderItem.create).toHaveBeenCalledWith({
        data: {
          tenant_id: tenantId,
          purchase_order_id: 'po-1',
          catalog_item_id: 'catalog-1',
          quantity: new Prisma.Decimal('1.5'),
          unit_cost: 10,
          quantity_received: 0,
        },
        select: { id: true },
      });
      expect(tx.partsReservation.updateMany).toHaveBeenCalledWith({
        where: {
          tenant_id: tenantId,
          id: 'reservation-1',
          purchase_order_item_id: null,
          status: {
            in: [
              PartsReservationStatus.OPEN,
              PartsReservationStatus.ORDERED,
            ],
          },
        },
        data: { purchase_order_item_id: 'poi-1' },
      });
      expect(result).toMatchObject({ id: 'po-1' });
    });

    it('rejects a reservation that is already linked to a purchase order item', async () => {
      tx.partsRequisition.findFirst.mockResolvedValue({
        id: 'requisition-1',
        status: PartsRequisitionStatus.DRAFT,
      });
      tx.partsReservation.findMany.mockResolvedValueOnce([
        {
          id: 'reservation-1',
          quantity: new Prisma.Decimal('1.5'),
          status: PartsReservationStatus.OPEN,
          kind: PartsReservationKind.REQUISITION,
          purchase_order_item_id: 'poi-existing',
          requisition_line: { requisition_id: 'requisition-1' },
          workshop_task_line_item: {
            catalog_item_id: 'catalog-1',
            workshop_task: { workshop_order: { site_id: siteId } },
          },
        },
      ]);
      tx.vendor.findFirst.mockResolvedValue({
        id: vendorId,
        name: 'Vendor',
        supportedBrands: [],
      });
      tx.catalogItem.findMany.mockResolvedValue([
        { id: 'catalog-1', brand_id: null, brand: null },
      ]);

      await expect(
        service.createPurchaseOrderForRequisition('requisition-1', {
          vendorId,
          items: [{ reservationId: 'reservation-1', unitCost: 10 }],
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(tx.purchaseOrder.create).not.toHaveBeenCalled();
    });
  });
});
