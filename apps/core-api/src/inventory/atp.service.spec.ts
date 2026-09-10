import {
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LocationType, Prisma } from '@prisma/client';
import { AtpService } from './atp.service';
import { PrismaService } from '../prisma/prisma.service';
import { SiteContextService } from '../common/services/site-context.service';
import { TenantContextService } from '../common/services/tenant-context.service';

describe('AtpService', () => {
  let service: AtpService;
  let prisma: {
    inventoryStock: { findFirst: jest.Mock };
    partsReservation: { findMany: jest.Mock };
    $executeRaw: jest.Mock;
  };
  let transactionClient: typeof prisma;

  const TENANT_ID = 'tenant-1';
  const SITE_ID = 'site-1';
  const STOCK_ID = 'stock-1';
  const LOCATION_ID = 'location-1';

  beforeEach(async () => {
    prisma = {
      inventoryStock: { findFirst: jest.fn() },
      partsReservation: { findMany: jest.fn() },
      $executeRaw: jest.fn(),
    };
    transactionClient = {
      inventoryStock: { findFirst: jest.fn() },
      partsReservation: { findMany: jest.fn() },
      $executeRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AtpService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: TenantContextService,
          useValue: { getTenantId: jest.fn().mockResolvedValue(TENANT_ID) },
        },
        {
          provide: SiteContextService,
          useValue: { getSiteId: jest.fn().mockResolvedValue(SITE_ID) },
        },
      ],
    }).compile();

    service = module.get<AtpService>(AtpService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserves a fractional quantity with a tenant/site/non-tote predicate', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('4.0'),
      quantity_reserved: new Prisma.Decimal('2.5'),
    });
    prisma.$executeRaw.mockResolvedValue(1);

    await service.reserveOnHand({
      stockId: STOCK_ID,
      quantity: new Prisma.Decimal('1.5'),
    });

    expect(prisma.inventoryStock.findFirst).toHaveBeenCalledWith({
      where: {
        id: STOCK_ID,
        tenant_id: TENANT_ID,
        location: {
          tenant_id: TENANT_ID,
          site_id: SITE_ID,
          type: { not: LocationType.staging_tote },
        },
      },
      select: {
        id: true,
        location_id: true,
        quantity_on_hand: true,
        quantity_reserved: true,
      },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [template, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(Array.from(template).join(' ')).toContain(
      'stock.quantity_on_hand - stock.quantity_reserved >=',
    );
    expect(values).toContain(TENANT_ID);
    expect(values).toContain(STOCK_ID);
    expect(values.some((value) => String(value) === '1.5')).toBe(true);
  });

  it('returns a conflict when the conditional reservation update affects no rows', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('1'),
      quantity_reserved: new Prisma.Decimal('0'),
    });
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      service.reserveOnHand({ stockId: STOCK_ID, quantity: '1.1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('releases reserved quantity with the inverse conditional predicate', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('4'),
      quantity_reserved: new Prisma.Decimal('2'),
    });
    prisma.$executeRaw.mockResolvedValue(1);

    await service.releaseOnHand({ stockId: STOCK_ID, quantity: '1.5' });

    const [template, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(Array.from(template).join(' ')).toContain(
      'SET quantity_reserved = quantity_reserved -',
    );
    expect(Array.from(template).join(' ')).toContain(
      'quantity_reserved >=',
    );
    expect(values.some((value) => String(value) === '1.5')).toBe(true);
  });

  it('deducts only free on-hand quantity with a tenant/site/non-tote predicate', async () => {
    prisma.$executeRaw.mockResolvedValue(1);

    await service.deductOnHandForSale({
      stockId: STOCK_ID,
      quantity: new Prisma.Decimal('1.5'),
      tenantId: TENANT_ID,
      siteId: SITE_ID,
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [template, ...values] = prisma.$executeRaw.mock.calls[0];
    const sql = Array.from(template).join(' ');
    expect(sql).toContain('SET quantity_on_hand = quantity_on_hand -');
    expect(sql).toContain(
      'stock.quantity_on_hand - stock.quantity_reserved >=',
    );
    expect(sql).toContain('location.site_id =');
    expect(sql).toContain('location.type <>');
    expect(values).toContain(TENANT_ID);
    expect(values).toContain(SITE_ID);
    expect(values).toContain(STOCK_ID);
    expect(values.some((value) => String(value) === '1.5')).toBe(true);
  });

  it('returns a conflict when a sale deduction loses the free ATP race', async () => {
    prisma.$executeRaw.mockResolvedValue(0);

    await expect(
      service.deductOnHandForSale({
        stockId: STOCK_ID,
        quantity: '1',
        tenantId: TENANT_ID,
        siteId: SITE_ID,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('uses the supplied transaction client for sale deductions', async () => {
    transactionClient.$executeRaw.mockResolvedValue(1);

    await service.deductOnHandForSale(
      {
        stockId: STOCK_ID,
        quantity: '1.5',
        tenantId: TENANT_ID,
        siteId: SITE_ID,
      },
      transactionClient as never,
    );

    expect(transactionClient.$executeRaw).toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('fails closed when ATP is negative and logs structured invariant context', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('1'),
      quantity_reserved: new Prisma.Decimal('1.1'),
    });
    const loggerError = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation();

    await expect(
      service.reserveOnHand({ stockId: STOCK_ID, quantity: '0.1' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(loggerError).toHaveBeenCalledWith(
      expect.stringContaining('atp_negative'),
    );
  });

  it('reconciles reserved cache against active ON_HAND slices', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      catalog_item_id: 'item-1',
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('10'),
      quantity_reserved: new Prisma.Decimal('3.5'),
    });
    prisma.partsReservation.findMany.mockResolvedValue([
      {
        quantity: new Prisma.Decimal('1.5'),
        quantity_received: new Prisma.Decimal('0'),
      },
      {
        quantity: new Prisma.Decimal('2'),
        quantity_received: new Prisma.Decimal('0'),
      },
    ]);

    await expect(service.reconcileStock(STOCK_ID)).resolves.toBeUndefined();

    expect(prisma.partsReservation.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: TENANT_ID,
        kind: 'ON_HAND',
        status: 'OPEN',
        location_id: LOCATION_ID,
        workshop_task_line_item: {
          tenant_id: TENANT_ID,
          catalog_item_id: 'item-1',
        },
      },
      select: { quantity: true, quantity_received: true },
    });
  });

  it('throws an invariant error when reconciliation does not match', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      catalog_item_id: 'item-1',
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('10'),
      quantity_reserved: new Prisma.Decimal('3.5'),
    });
    prisma.partsReservation.findMany.mockResolvedValue([
      {
        quantity: new Prisma.Decimal('2'),
        quantity_received: new Prisma.Decimal('0'),
      },
    ]);

    await expect(service.reconcileStock(STOCK_ID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('reconciles only the remaining open commitment after partial staging', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      catalog_item_id: 'item-1',
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('10'),
      quantity_reserved: new Prisma.Decimal('3'),
    });
    prisma.partsReservation.findMany.mockResolvedValue([
      {
        quantity: new Prisma.Decimal('4'),
        quantity_received: new Prisma.Decimal('1'),
      },
    ]);

    await expect(service.reconcileStock(STOCK_ID)).resolves.toBeUndefined();
  });

  it('fails closed when an open reservation counter is negative', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      catalog_item_id: 'item-1',
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('10'),
      quantity_reserved: new Prisma.Decimal('3'),
    });
    prisma.partsReservation.findMany.mockResolvedValue([
      {
        quantity: new Prisma.Decimal('4'),
        quantity_received: new Prisma.Decimal('-1'),
      },
    ]);

    await expect(service.reconcileStock(STOCK_ID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('fails closed when an open reservation has received more than reserved', async () => {
    prisma.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      catalog_item_id: 'item-1',
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('10'),
      quantity_reserved: new Prisma.Decimal('0'),
    });
    prisma.partsReservation.findMany.mockResolvedValue([
      {
        quantity: new Prisma.Decimal('4'),
        quantity_received: new Prisma.Decimal('5'),
      },
    ]);

    await expect(service.reconcileStock(STOCK_ID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('uses the supplied transaction client without opening a nested transaction', async () => {
    transactionClient.inventoryStock.findFirst.mockResolvedValue({
      id: STOCK_ID,
      location_id: LOCATION_ID,
      quantity_on_hand: new Prisma.Decimal('4'),
      quantity_reserved: new Prisma.Decimal('0'),
    });
    transactionClient.$executeRaw.mockResolvedValue(1);

    await service.reserveOnHand(
      { stockId: STOCK_ID, quantity: '1.5' },
      transactionClient as never,
    );

    expect(transactionClient.inventoryStock.findFirst).toHaveBeenCalled();
    expect(transactionClient.$executeRaw).toHaveBeenCalled();
    expect(prisma.inventoryStock.findFirst).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
