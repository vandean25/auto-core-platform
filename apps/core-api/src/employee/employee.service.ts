import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';

@Injectable()
export class EmployeeService {
  constructor(private readonly prisma: PrismaService) {}

  private mapEmployee(employee: {
    id: string;
    name: string;
    role: EmployeeRole;
    is_active: boolean;
    sort_order: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: employee.id,
      name: employee.name,
      role: employee.role,
      isActive: employee.is_active,
      sortOrder: employee.sort_order,
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  async findAll(query: ListEmployeesQueryDto) {
    const where = {
      ...(query.includeInactive ? {} : { is_active: true }),
      ...(query.role ? { role: query.role } : {}),
    };

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const [employees, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.employee.count({ where }),
    ]);

    return {
      data: employees.map((employee) => this.mapEmployee(employee)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id } });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return this.mapEmployee(employee);
  }

  async create(dto: CreateEmployeeDto) {
    const created = await this.prisma.employee.create({
      data: {
        name: dto.name.trim(),
        role: dto.role,
        is_active: dto.isActive ?? true,
        sort_order: dto.sortOrder ?? 0,
      },
    });

    return this.mapEmployee(created);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const existing = await this.prisma.employee.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const updated = await this.prisma.employee.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        ...(dto.sortOrder !== undefined && { sort_order: dto.sortOrder }),
      },
    });

    return this.mapEmployee(updated);
  }

  async remove(id: string) {
    const existing = await this.prisma.employee.findFirst({ where: { id } });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const linkedOrders = await this.prisma.workshopOrder.count({
      where: { mechanic_id: id },
    });
    if (linkedOrders > 0) {
      throw new ConflictException(
        `Cannot delete employee with ${linkedOrders} linked workshop orders`,
      );
    }

    if (existing.is_active) {
      const updated = await this.prisma.employee.update({
        where: { id },
        data: { is_active: false },
      });
      return { id: updated.id, isActive: updated.is_active };
    }

    await this.prisma.employee.delete({ where: { id } });
    return { id, deleted: true };
  }
}
