import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VehicleEquipmentAssertion } from '@prisma/client';
import { VehicleEquipmentService } from './vehicle-equipment.service.js';

describe('VehicleEquipmentService', () => {
  const tenantId = 'tenant-1';
  const vehicleId = 'vehicle-1';
  const stockPurchaseId = 'purchase-1';
  const siteId = 'site-1';
  const optionId = 'option-abs';

  const tenantContext = {
    getTenantId: jest.fn().mockResolvedValue(tenantId),
    getAuthenticatedUser: jest.fn().mockReturnValue({ role: 'OWNER' }),
  };
  const siteContext = {
    getSiteId: jest.fn().mockResolvedValue(siteId),
  };

  function createService(prisma: Record<string, unknown>) {
    return new VehicleEquipmentService(
      prisma as never,
      tenantContext as never,
      siteContext as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replaces selections and free text for the current stock purchase', async () => {
    const vehicleEquipmentSelection = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([
        {
          assertion: VehicleEquipmentAssertion.PRESENT,
          option: {
            id: optionId,
            code: 'ABS',
            label_de: 'ABS',
            label_en: 'ABS',
            category: 'SAFETY',
            active: true,
          },
        },
      ]),
    };
    const vehicleEquipmentFreeTextItem = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany: jest.fn().mockResolvedValue([
        { id: 'ft-1', text: 'Sunroof', sort_order: 0 },
      ]),
    };
    const vehicle = {
      findFirst: jest.fn().mockResolvedValue({ id: vehicleId }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const prisma = {
      vehicle,
      vehiclePurchase: {
        findFirst: jest.fn().mockResolvedValue({ id: stockPurchaseId }),
      },
      vehicleEquipmentOption: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: optionId,
            code: 'ABS',
            label_de: 'ABS',
            label_en: 'ABS',
            category: 'SAFETY',
            active: true,
          },
        ]),
      },
      vehicleEquipmentSelection,
      vehicleEquipmentFreeTextItem,
      $transaction: jest.fn(async (callback) =>
        callback({
          vehicle,
          vehicleEquipmentSelection,
          vehicleEquipmentFreeTextItem,
        }),
      ),
    };

    const service = createService(prisma);
    const result = await service.replaceVehicleEquipment(vehicleId, {
      selections: [
        {
          option_id: optionId,
          assertion: VehicleEquipmentAssertion.PRESENT,
        },
      ],
      free_text_lines: ['Sunroof'],
    });

    expect(vehicleEquipmentSelection.deleteMany).toHaveBeenCalledWith({
      where: { tenant_id: tenantId, stock_purchase_id: stockPurchaseId },
    });
    expect(vehicleEquipmentSelection.createMany).toHaveBeenCalledWith({
      data: [
        {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          stock_purchase_id: stockPurchaseId,
          option_id: optionId,
          assertion: VehicleEquipmentAssertion.PRESENT,
        },
      ],
    });
    expect(result.stock_purchase_id).toBe(stockPurchaseId);
    expect(result.selections).toHaveLength(1);
    expect(result.free_text_items[0].text).toBe('Sunroof');
  });

  it('rejects inactive or foreign option ids', async () => {
    const prisma = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({ id: vehicleId }),
      },
      vehiclePurchase: {
        findFirst: jest.fn().mockResolvedValue({ id: stockPurchaseId }),
      },
      vehicleEquipmentOption: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = createService(prisma);

    await expect(
      service.replaceVehicleEquipment(vehicleId, {
        selections: [
          {
            option_id: optionId,
            assertion: VehicleEquipmentAssertion.ABSENT,
          },
        ],
        free_text_lines: [],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns 404 when the vehicle is not on the active site lot', async () => {
    const prisma = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = createService(prisma);

    await expect(service.getVehicleEquipment(vehicleId)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
