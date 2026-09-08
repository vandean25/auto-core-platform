import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { HrWorkScheduleService } from '../hr/hr-work-schedule.service';
import {
  CreateEmployeeDto,
  ListEmployeesQueryDto,
  UpdateEmployeeDto,
} from './dto/employee.dto';
import { EmployeeLifecycleService } from './employee-lifecycle.service';
import { EmployeeLeaveService } from './employee-leave.service';
import {
  buildEmployeeUpdateData,
  handleEmployeeConflict,
  toDateOnly,
} from './employee.helpers';

const TENANT_ADMIN_ROLES = new Set(['OWNER', 'ADMIN']);

@Injectable()
export class EmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly scheduleService: HrWorkScheduleService,
    private readonly lifecycleService: EmployeeLifecycleService = new EmployeeLifecycleService(
      prisma,
    ),
    private readonly leaveService: EmployeeLeaveService = new EmployeeLeaveService(
      prisma,
      scheduleService,
    ),
  ) {}

  async findAll(query: ListEmployeesQueryDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const where = {
      tenant_id: tenantId,
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
      data: await this.leaveService.attachRemaining(tenantId, employees),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const employee = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    const [mapped] = await this.leaveService.attachRemaining(tenantId, [
      employee,
    ]);
    return mapped;
  }

  async create(dto: CreateEmployeeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    this.assertTenantAdminForHrFields(dto);

    try {
      const hiredOn = toDateOnly(dto.hiredOn);
      const effectiveFrom =
        hiredOn ?? (await this.leaveService.getCurrentLocalDate(tenantId));

      const created = await this.prisma.$transaction(async (transaction) => {
        const employee = await transaction.employee.create({
          data: {
            tenant_id: tenantId,
            name: dto.name.trim(),
            role: dto.role,
            is_active: dto.isActive ?? true,
            sort_order: dto.sortOrder ?? 0,
            annual_leave_minutes: 0,
            hired_on: hiredOn,
            ...(dto.userId !== undefined && { user_id: dto.userId }),
            ...(dto.motherLanguageCode !== undefined && {
              mother_language_code: dto.motherLanguageCode,
            }),
          },
        });

        const annualLeaveMinutes =
          await this.leaveService.seedInitialScheduleAndAllowance(
            transaction,
            tenantId,
            employee.id,
            effectiveFrom,
            dto.annualLeaveMinutes,
          );

        const updated = await transaction.employee.updateMany({
          where: { id: employee.id, tenant_id: tenantId },
          data: { annual_leave_minutes: annualLeaveMinutes },
        });
        if (updated.count === 0) {
          throw new NotFoundException(`Employee ${employee.id} not found`);
        }

        return transaction.employee.findFirstOrThrow({
          where: { id: employee.id, tenant_id: tenantId },
        });
      });

      const [mapped] = await this.leaveService.attachRemaining(tenantId, [
        created,
      ]);
      return mapped;
    } catch (error) {
      handleEmployeeConflict(error);
    }
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    this.assertTenantAdminForHrFields(dto);

    try {
      const updateData = buildEmployeeUpdateData(dto);
      const updated = await this.saveEmployeeUpdate(
        id,
        tenantId,
        updateData,
        dto.annualLeaveMinutes,
      );

      const [mapped] = await this.leaveService.attachRemaining(tenantId, [
        updated,
      ]);
      return mapped;
    } catch (error) {
      handleEmployeeConflict(error);
    }
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.lifecycleService.remove(tenantId, id);
  }

  private async saveEmployeeUpdate(
    id: string,
    tenantId: string,
    updateData: Prisma.EmployeeUncheckedUpdateManyInput,
    annualLeaveMinutes?: number,
  ) {
    if (annualLeaveMinutes === undefined) {
      return this.updateEmployee(id, tenantId, updateData);
    }

    return this.prisma.$transaction(async (transaction) => {
      const updated = await this.updateEmployee(
        id,
        tenantId,
        updateData,
        transaction,
      );
      await this.leaveService.updateCurrentYearLeaveBalance(
        transaction,
        tenantId,
        id,
        annualLeaveMinutes,
      );
      return updated;
    });
  }

  private async updateEmployee(
    id: string,
    tenantId: string,
    updateData: Prisma.EmployeeUncheckedUpdateManyInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const updated = await db.employee.updateMany({
      where: { id, tenant_id: tenantId },
      data: updateData,
    });
    if (updated.count === 0) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    const employee = await db.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!employee) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return employee;
  }

  private assertTenantAdminForHrFields(
    dto: CreateEmployeeDto | UpdateEmployeeDto,
  ): void {
    const includesHrFields =
      dto.hiredOn !== undefined || dto.annualLeaveMinutes !== undefined;
    if (!includesHrFields) {
      return;
    }

    const role = this.tenantContext.getAuthenticatedUser()?.role;
    if (!role || !TENANT_ADMIN_ROLES.has(role)) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }
}
