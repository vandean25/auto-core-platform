import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeService } from './employee.service';

const mockPrisma = {
  employee: {
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

describe('EmployeeService', () => {
  let service: EmployeeService;

  const baseEmployee = {
    id: 'emp-1',
    name: 'Jane Doe',
    role: EmployeeRole.MECHANIC,
    is_active: true,
    sort_order: 1,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeEach(() => {
    service = new EmployeeService(mockPrisma as unknown as PrismaService);
    jest.clearAllMocks();
  });

  it('lists active employees by default', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    await service.findAll({});

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { is_active: true },
      }),
    );
  });

  it('supports role and includeInactive filters', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    await service.findAll({ role: EmployeeRole.MECHANIC, includeInactive: true });

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: EmployeeRole.MECHANIC },
      }),
    );
  });

  it('throws not found on update missing employee', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('soft-disables employee on first delete when unreferenced', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.employee.update.mockResolvedValue({
      ...baseEmployee,
      is_active: false,
    });

    const result = await service.remove('emp-1');

    expect(result.isActive).toBe(false);
    expect(mockPrisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { is_active: false },
    });
  });

  it('blocks delete when employee is referenced by workshop orders', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(1);

    await expect(service.remove('emp-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    expect(mockPrisma.employee.delete).not.toHaveBeenCalled();
  });

  it('hard deletes only when already inactive and unreferenced', async () => {
    mockPrisma.employee.findUnique.mockResolvedValue({
      ...baseEmployee,
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.employee.delete.mockResolvedValue({ id: 'emp-1' });

    const result = await service.remove('emp-1');

    expect(result).toEqual({ id: 'emp-1', deleted: true });
    expect(mockPrisma.employee.delete).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
    });
  });
});
