import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeeDeleteResponseDto } from './dto/employee.dto';

@Injectable()
export class EmployeeLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async remove(
    tenantId: string,
    id: string,
  ): Promise<EmployeeDeleteResponseDto> {
    const existing = await this.prisma.employee.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }

    await this.assertNoWorkshopOrders(tenantId, id);

    if (existing.is_active) {
      return this.softDelete(tenantId, id);
    }

    await this.assertNoLinkedRecords(tenantId, id);
    return this.hardDelete(tenantId, id);
  }

  private async assertNoWorkshopOrders(
    tenantId: string,
    id: string,
  ): Promise<void> {
    const linkedOrders = await this.prisma.workshopOrder.count({
      where: { tenant_id: tenantId, mechanic_id: id },
    });
    if (linkedOrders > 0) {
      throw new ConflictException(
        `Cannot delete employee with ${linkedOrders} linked workshop orders`,
      );
    }
  }

  private async assertNoLinkedRecords(
    tenantId: string,
    id: string,
  ): Promise<void> {
    await Promise.all([
      this.assertNoWorkRecords(tenantId, id),
      this.assertNoHrRecords(tenantId, id),
    ]);
  }

  private async assertNoWorkRecords(
    tenantId: string,
    id: string,
  ): Promise<void> {
    const [tasks, media, voiceNotes, laborEntries] = await Promise.all([
      this.prisma.workshopTask.count({
        where: { tenant_id: tenantId, mechanic_id: id },
      }),
      this.prisma.workshopMedia.count({
        where: { tenant_id: tenantId, uploaded_by_employee_id: id },
      }),
      this.prisma.workshopVoiceNoteDraft.count({
        where: { tenant_id: tenantId, mechanic_employee_id: id },
      }),
      this.prisma.laborEntry.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
    ]);
    if (tasks > 0 || media > 0 || voiceNotes > 0 || laborEntries > 0) {
      throw new ConflictException(
        'Cannot delete employee with linked work records',
      );
    }
  }

  private async assertNoHrRecords(tenantId: string, id: string): Promise<void> {
    const [attendance, leave, balances] = await Promise.all([
      this.prisma.attendanceEvent.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
      this.prisma.leaveRequest.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
      this.prisma.employeeLeaveBalance.count({
        where: { tenant_id: tenantId, employee_id: id },
      }),
    ]);
    if (attendance > 0 || leave > 0 || balances > 0) {
      throw new ConflictException(
        'Cannot delete employee with attendance, leave, or balance records',
      );
    }
  }

  private async softDelete(
    tenantId: string,
    id: string,
  ): Promise<EmployeeDeleteResponseDto> {
    const updated = await this.prisma.employee.updateMany({
      where: { id, tenant_id: tenantId },
      data: { is_active: false },
    });
    if (updated.count === 0) {
      throw new NotFoundException(`Employee with ID ${id} not found`);
    }
    return { id, isActive: false };
  }

  private async hardDelete(
    tenantId: string,
    id: string,
  ): Promise<EmployeeDeleteResponseDto> {
    try {
      const deleted = await this.prisma.employee.deleteMany({
        where: { id, tenant_id: tenantId },
      });
      if (deleted.count === 0) {
        throw new NotFoundException(`Employee with ID ${id} not found`);
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw new ConflictException(
          'Cannot delete employee because linked records were created concurrently',
        );
      }
      throw error;
    }
    return { id, deleted: true };
  }
}
