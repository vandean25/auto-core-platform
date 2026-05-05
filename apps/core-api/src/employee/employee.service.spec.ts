import { ConflictException, NotFoundException } from '@nestjs/common';
import { EmployeeRole, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeService } from './employee.service';

const mockPrisma = {
  employee: {
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

describe('EmployeeService', () => {
  let service: EmployeeService;

  const baseEmployee = {
    id: 'emp-1',
    name: 'Jane Doe',
    role: EmployeeRole.MECHANIC,
    is_active: true,
    sort_order: 1,
    user_id: null,
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

    const result = await service.findAll({});

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith({
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

  it('supports role and includeInactive filters', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    await service.findAll({
      role: EmployeeRole.MECHANIC,
      includeInactive: true,
      page: 2,
      limit: 10,
    });

    expect(mockPrisma.employee.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: EmployeeRole.MECHANIC },
        skip: 10,
        take: 10,
      }),
    );
  });

  it('exposes userId (null) in mapped response when not linked', async () => {
    mockPrisma.employee.findMany.mockResolvedValue([baseEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].userId).toBeNull();
  });

  it('exposes userId in mapped response when linked', async () => {
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-abc' };
    mockPrisma.employee.findMany.mockResolvedValue([linkedEmployee]);
    mockPrisma.employee.count.mockResolvedValue(1);

    const result = await service.findAll({});

    expect(result.data[0].userId).toBe('user-uuid-abc');
  });

  it('throws not found on update missing employee', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(null);

    await expect(service.update('missing', { name: 'New' })).rejects.toThrow(
      NotFoundException,
    );
  });

  it('links a userId when provided in update', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-xyz' };
    mockPrisma.employee.update.mockResolvedValue(linkedEmployee);

    const result = await service.update('emp-1', { userId: 'user-uuid-xyz' });

    expect(mockPrisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { user_id: 'user-uuid-xyz' },
    });
    expect(result.userId).toBe('user-uuid-xyz');
  });

  it('unlinks a userId when null is provided in update', async () => {
    const linkedEmployee = { ...baseEmployee, user_id: 'user-uuid-xyz' };
    mockPrisma.employee.findFirst.mockResolvedValue(linkedEmployee);
    mockPrisma.employee.update.mockResolvedValue({ ...baseEmployee, user_id: null });

    const result = await service.update('emp-1', { userId: null });

    expect(mockPrisma.employee.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { user_id: null },
    });
    expect(result.userId).toBeNull();
  });

  it('throws ConflictException when linking a userId already used in update', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    mockPrisma.employee.update.mockRejectedValue(p2002);

    await expect(
      service.update('emp-1', { userId: 'user-uuid-taken' }),
    ).rejects.toThrow(ConflictException);
  });

  it('sets userId when provided in create', async () => {
    const newEmployee = { ...baseEmployee, id: 'emp-new', user_id: 'user-uuid-new' };
    mockPrisma.employee.create.mockResolvedValue(newEmployee);

    const result = await service.create({
      name: 'New Mechanic',
      role: EmployeeRole.MECHANIC,
      userId: 'user-uuid-new',
    });

    expect(mockPrisma.employee.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_id: 'user-uuid-new' }),
      }),
    );
    expect(result.userId).toBe('user-uuid-new');
  });

  it('throws ConflictException when creating with a userId already in use', async () => {
    const p2002 = Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint violation', {
        code: 'P2002',
        clientVersion: '0',
      }),
    );
    mockPrisma.employee.create.mockRejectedValue(p2002);

    await expect(
      service.create({
        name: 'Duplicate',
        role: EmployeeRole.MECHANIC,
        userId: 'user-uuid-taken',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('soft-disables employee on first delete when unreferenced', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
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
    mockPrisma.employee.findFirst.mockResolvedValue(baseEmployee);
    mockPrisma.workshopOrder.count.mockResolvedValue(1);

    await expect(service.remove('emp-1')).rejects.toThrow(ConflictException);
    expect(mockPrisma.employee.update).not.toHaveBeenCalled();
    expect(mockPrisma.employee.delete).not.toHaveBeenCalled();
  });

  it('hard deletes only when already inactive and unreferenced', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
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
