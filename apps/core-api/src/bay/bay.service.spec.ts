import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BayService } from './bay.service';

const mockPrisma = {
  bay: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  workshopOrder: {
    count: jest.fn(),
  },
};

describe('BayService', () => {
  let service: BayService;

  const baseBay = {
    id: 'bay-1',
    name: 'Bay A',
    is_active: true,
    sort_order: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    service = new BayService(mockPrisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  it('lists active bays by default', async () => {
    mockPrisma.bay.findMany.mockResolvedValue([baseBay]);
    mockPrisma.bay.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(mockPrisma.bay.findMany).toHaveBeenCalledWith({
      where: { is_active: true },
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      skip: 0,
      take: 25,
    });
    expect(result.meta).toEqual({
      total: 1,
      page: 1,
      limit: 25,
      totalPages: 1,
    });
  });

  it('supports includeInactive list filter', async () => {
    mockPrisma.bay.findMany.mockResolvedValue([baseBay]);
    mockPrisma.bay.count.mockResolvedValue(1);

    await service.findAll({ includeInactive: true, page: 2, limit: 10 });

    expect(mockPrisma.bay.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 10,
        take: 10,
      }),
    );
  });

  it('maps duplicate create to ConflictException', async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint',
      {
        code: 'P2002',
        clientVersion: '0',
      },
    );
    mockPrisma.bay.create.mockRejectedValue(p2002);

    await expect(service.create({ name: 'Bay A' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('throws not found on update missing bay', async () => {
    mockPrisma.bay.findFirst.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'Bay B' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('maps duplicate update to ConflictException', async () => {
    mockPrisma.bay.findFirst.mockResolvedValue(baseBay);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint',
      {
        code: 'P2002',
        clientVersion: '0',
      },
    );
    mockPrisma.bay.update.mockRejectedValue(p2002);

    await expect(service.update('bay-1', { name: 'Bay B' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('blocks delete when bay is referenced by workshop orders', async () => {
    mockPrisma.bay.findFirst.mockResolvedValue(baseBay);
    mockPrisma.workshopOrder.count.mockResolvedValue(2);

    await expect(service.remove('bay-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.bay.update).not.toHaveBeenCalled();
    expect(mockPrisma.bay.delete).not.toHaveBeenCalled();
  });

  it('soft-disables bay on first delete when unreferenced', async () => {
    mockPrisma.bay.findFirst.mockResolvedValue(baseBay);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.bay.update.mockResolvedValue({ ...baseBay, is_active: false });

    const result = await service.remove('bay-1');

    expect(result.isActive).toBe(false);
    expect(mockPrisma.bay.update).toHaveBeenCalledWith({
      where: { id: 'bay-1' },
      data: { is_active: false },
    });
  });

  it('hard deletes only when already inactive and unreferenced', async () => {
    mockPrisma.bay.findFirst.mockResolvedValue({
      ...baseBay,
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.bay.delete.mockResolvedValue({ id: 'bay-1' });

    const result = await service.remove('bay-1');

    expect(result).toEqual({ id: 'bay-1', deleted: true });
    expect(mockPrisma.bay.delete).toHaveBeenCalledWith({
      where: { id: 'bay-1' },
    });
  });
});
