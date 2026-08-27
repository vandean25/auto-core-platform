import { Test, TestingModule } from '@nestjs/testing';
import { CatalogService } from './catalog.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';

describe('CatalogService Search (Mocked)', () => {
  let service: CatalogService;

  const mockPrisma = {
    workshopOrder: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    laborOperation: {
      findMany: jest.fn(),
    },
    masterPart: {
      findMany: jest.fn(),
    },
    catalogItem: {
      findMany: jest.fn(),
    },
  };

  const mockTenantContext = {
    getTenantId: jest.fn().mockResolvedValue('test-tenant-id'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogService,
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
        {
          provide: TenantContextService,
          useValue: mockTenantContext,
        },
      ],
    }).compile();

    service = module.get<CatalogService>(CatalogService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should include universal items (no fitments) and specific items in the search query', async () => {
    // 1. Mock Workshop Order & Vehicle
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      vehicle: {
        make: 'Volkswagen',
        model: 'Golf VII',
        year: 2018,
        engine_code: 'CHPA',
      },
    });

    // 2. Mock search results
    mockPrisma.laborOperation.findMany.mockResolvedValue([
      {
        id: '1',
        code: 'UNIVERSAL',
        description: 'Universal Item',
        standard_aw: 1,
        hourly_rate: 100,
        category: { name: 'General' },
      },
    ]);
    mockPrisma.masterPart.findMany.mockResolvedValue([]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([]);

    // 3. Perform search
    const query = 'test';
    const workshopOrderId = 'mock-order-id';
    await service.search(query, workshopOrderId);

    // 4. Verify findMany was called with the correct logic
    expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenant_id: 'test-tenant-id',
          is_active: true,
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  code: expect.objectContaining({ contains: query }),
                }),
                expect.objectContaining({
                  description: expect.objectContaining({ contains: query }),
                }),
                expect.objectContaining({
                  category: {
                    name: expect.objectContaining({ contains: query }),
                  },
                }),
              ]),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  fitments: { some: expect.any(Object) },
                }),
                expect.objectContaining({ fitments: { none: {} } }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it.each([
    ['oil', 'description fragment'],
    ['br', 'partial token'],
    ['Engine', 'category name'],
    ['BP-1015-MAH', 'catalog sku'],
  ])(
    'should search labor and catalog items by %s (%s)',
    async (query) => {
      mockPrisma.workshopOrder.findFirst.mockResolvedValue({
        vehicle: {
          make: 'Volkswagen',
          model: 'Golf VII',
          year: 2018,
          engine_code: null,
        },
      });
      mockPrisma.laborOperation.findMany.mockResolvedValue([]);
      mockPrisma.masterPart.findMany.mockResolvedValue([]);
      mockPrisma.catalogItem.findMany.mockResolvedValue([]);

      await service.search(query, 'mock-order-id');

      expect(mockPrisma.laborOperation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([
              expect.objectContaining({
                OR: expect.arrayContaining([
                  expect.objectContaining({
                    description: expect.objectContaining({ contains: query }),
                  }),
                ]),
              }),
            ]),
          }),
        }),
      );

      expect(mockPrisma.catalogItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'test-tenant-id',
            OR: expect.arrayContaining([
              expect.objectContaining({
                sku: expect.objectContaining({ contains: query }),
              }),
              expect.objectContaining({
                name: expect.objectContaining({ contains: query }),
              }),
              expect.objectContaining({
                brand: {
                  name: expect.objectContaining({ contains: query }),
                },
              }),
            ]),
          }),
        }),
      );
    },
  );

  it('should throw NotFoundException if workshop order vehicle is missing', async () => {
    mockPrisma.workshopOrder.findFirst.mockResolvedValue(null);

    await expect(service.search('test', 'invalid-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should include universal master parts (no fitments) and exclude non-matching fitments', async () => {
    // 1. Mock Workshop Order & Vehicle
    mockPrisma.workshopOrder.findFirst.mockResolvedValue({
      vehicle: {
        make: 'Volkswagen',
        model: 'Golf VII',
        year: 2018,
        engine_code: 'CHPA',
      },
    });

    // 2. Mock results: only the universal master part is returned
    mockPrisma.laborOperation.findMany.mockResolvedValue([]);
    mockPrisma.masterPart.findMany.mockResolvedValue([
      {
        id: 'mp-1',
        supplier_part_number: 'TEST-UNIV-001',
        description: 'Universal Oil Filter',
        brand: 'OEM',
        local_inventory: null,
      },
    ]);
    mockPrisma.catalogItem.findMany.mockResolvedValue([]);

    // 3. Perform search
    await service.search('test', 'mock-order-id');

    // 4. Verify masterPart.findMany was called with universal-part (no fitments) OR matching fitments filter
    expect(mockPrisma.masterPart.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  fitments: { some: expect.any(Object) },
                }),
                expect.objectContaining({ fitments: { none: {} } }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });
});
