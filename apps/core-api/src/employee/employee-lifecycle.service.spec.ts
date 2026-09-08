import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeLifecycleService } from './employee-lifecycle.service';

describe('EmployeeLifecycleService', () => {
  let service: EmployeeLifecycleService;
  const mockPrisma = {
    employee: {
      findFirst: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    workshopOrder: {
      count: jest.fn(),
    },
    workshopTask: {
      count: jest.fn(),
    },
    workshopMedia: {
      count: jest.fn(),
    },
    workshopVoiceNoteDraft: {
      count: jest.fn(),
    },
    laborEntry: {
      count: jest.fn(),
    },
    attendanceEvent: {
      count: jest.fn(),
    },
    leaveRequest: {
      count: jest.fn(),
    },
    employeeLeaveBalance: {
      count: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EmployeeLifecycleService(
      mockPrisma as unknown as PrismaService,
    );
  });

  it('throws NotFoundException if employee does not exist', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue(null);

    await expect(service.remove('tenant-1', 'emp-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws ConflictException if employee has linked workshop orders', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: true,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(2);

    await expect(service.remove('tenant-1', 'emp-1')).rejects.toThrow(
      new ConflictException(
        'Cannot delete employee with 2 linked workshop orders',
      ),
    );
  });

  it('soft-deletes active employee by setting is_active to false', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: true,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.employee.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.remove('tenant-1', 'emp-1');

    expect(result).toEqual({ id: 'emp-1', isActive: false });
    expect(mockPrisma.employee.updateMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
      data: { is_active: false },
    });
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks hard deletion if inactive employee has linked work records', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.workshopTask.count.mockResolvedValue(1);
    mockPrisma.workshopMedia.count.mockResolvedValue(0);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(0);
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(0);

    await expect(service.remove('tenant-1', 'emp-1')).rejects.toThrow(
      new ConflictException('Cannot delete employee with linked work records'),
    );
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('blocks hard deletion if inactive employee has linked HR records', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.workshopTask.count.mockResolvedValue(0);
    mockPrisma.workshopMedia.count.mockResolvedValue(0);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(0);
    mockPrisma.attendanceEvent.count.mockResolvedValue(1);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(0);

    await expect(service.remove('tenant-1', 'emp-1')).rejects.toThrow(
      new ConflictException(
        'Cannot delete employee with attendance, leave, or balance records',
      ),
    );
    expect(mockPrisma.employee.deleteMany).not.toHaveBeenCalled();
  });

  it('hard-deletes unreferenced inactive employee', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.workshopTask.count.mockResolvedValue(0);
    mockPrisma.workshopMedia.count.mockResolvedValue(0);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(0);
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(0);
    mockPrisma.employee.deleteMany.mockResolvedValue({ count: 1 });

    const result = await service.remove('tenant-1', 'emp-1');

    expect(result).toEqual({ id: 'emp-1', deleted: true });
    expect(mockPrisma.employee.deleteMany).toHaveBeenCalledWith({
      where: { id: 'emp-1', tenant_id: 'tenant-1' },
    });
  });

  it('handles concurrent link creation P2003 on hard delete', async () => {
    mockPrisma.employee.findFirst.mockResolvedValue({
      id: 'emp-1',
      is_active: false,
    });
    mockPrisma.workshopOrder.count.mockResolvedValue(0);
    mockPrisma.workshopTask.count.mockResolvedValue(0);
    mockPrisma.workshopMedia.count.mockResolvedValue(0);
    mockPrisma.workshopVoiceNoteDraft.count.mockResolvedValue(0);
    mockPrisma.laborEntry.count.mockResolvedValue(0);
    mockPrisma.attendanceEvent.count.mockResolvedValue(0);
    mockPrisma.leaveRequest.count.mockResolvedValue(0);
    mockPrisma.employeeLeaveBalance.count.mockResolvedValue(0);

    const p2003 = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: '0' },
    );
    mockPrisma.employee.deleteMany.mockRejectedValue(p2003);

    await expect(service.remove('tenant-1', 'emp-1')).rejects.toThrow(
      new ConflictException(
        'Cannot delete employee because linked records were created concurrently',
      ),
    );
  });
});
