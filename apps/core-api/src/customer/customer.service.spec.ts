import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CustomerService } from './customer.service';

describe('CustomerService', () => {
  let service: CustomerService;

  const mockPrisma = {
    customer: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    salesOrder: { count: jest.fn() },
    invoice: { count: jest.fn() },
    workshopOrder: { count: jest.fn() },
    vehicle: { count: jest.fn() },
    vehiclePurchase: { count: jest.fn() },
    vehicleSale: { count: jest.fn() },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
        { provide: PrismaService, useValue: mockPrisma },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockResolvedValue('tenant-1') },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
    jest.clearAllMocks();
  });

  it('does not expose identity resolution state from customer detail vehicles', async () => {
    const vehicle = {
      id: 'vehicle-1',
      identity_resolution_generation: 'generation-1',
      identity_resolution_token: 'token-1',
    };
    mockPrisma.customer.findFirst.mockResolvedValue({
      id: 'customer-1',
      vehicles: [vehicle],
      sales_orders: [],
      workshop_orders: [{ vehicle }],
      invoices: [],
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);

    const result = await service.findOne('customer-1');

    expect(result.vehicles[0]).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.vehicles[0]).not.toHaveProperty('identity_resolution_token');
    expect(result.workshop_orders[0].vehicle).not.toHaveProperty(
      'identity_resolution_generation',
    );
    expect(result.workshop_orders[0].vehicle).not.toHaveProperty(
      'identity_resolution_token',
    );
  });

  it('deletes customer when no linked business records exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(0);
    mockPrisma.vehiclePurchase.count.mockResolvedValue(0);
    mockPrisma.vehicleSale.count.mockResolvedValue(0);
    mockPrisma.customer.deleteMany.mockResolvedValue({ id: 'c-1', count: 1 });

    await service.remove('c-1');

    expect(mockPrisma.customer.deleteMany).toHaveBeenCalledWith({
      where: { id: 'c-1', tenant_id: 'tenant-1' },
    });
  });

  it('blocks delete when orders/invoices/workshop orders are linked', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(1);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(0);
    mockPrisma.vehiclePurchase.count.mockResolvedValue(0);
    mockPrisma.vehicleSale.count.mockResolvedValue(0);

    await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
  });

  it('blocks delete when vehicle purchases or sales are linked', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(0);
    mockPrisma.vehiclePurchase.count.mockResolvedValue(1);
    mockPrisma.vehicleSale.count.mockResolvedValue(0);

    await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
  });

  it('blocks delete when vehicles are linked', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue({ id: 'c-1' });
    mockPrisma.salesOrder.count.mockResolvedValue(0);
    mockPrisma.invoice.count.mockResolvedValue(0);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.vehicle.count.mockResolvedValue(2);
    mockPrisma.vehiclePurchase.count.mockResolvedValue(0);
    mockPrisma.vehicleSale.count.mockResolvedValue(0);

    await expect(service.remove('c-1')).rejects.toThrow(BadRequestException);
  });

  it('throws not found when customer does not exist', async () => {
    mockPrisma.customer.findFirst.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });
});
