import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface AssignableBoardResources {
  tx: Prisma.TransactionClient;
  tenantId: string;
  siteId: string;
  mechanicId?: string | null;
  bayId?: string | null;
}

/**
 * Shared validation for board assign and INTAKE create. A missing, foreign or inactive
 * resource is a 404; a non-MECHANIC employee is a 422.
 */
export async function assertAssignableBoardResources({
  tx,
  tenantId,
  siteId,
  mechanicId,
  bayId,
}: AssignableBoardResources): Promise<void> {
  if (mechanicId !== undefined && mechanicId !== null) {
    const mechanic = await tx.employee.findFirst({
      where: { id: mechanicId, tenant_id: tenantId },
      select: { id: true, role: true, is_active: true },
    });

    if (!mechanic) {
      throw new NotFoundException(`Employee ${mechanicId} not found`);
    }

    if (mechanic.role !== 'MECHANIC') {
      throw new UnprocessableEntityException(
        `Employee ${mechanicId} is not a MECHANIC (role: ${mechanic.role})`,
      );
    }

    if (!mechanic.is_active) {
      throw new NotFoundException(`Employee ${mechanicId} is inactive`);
    }
  }

  if (bayId !== undefined && bayId !== null) {
    const bay = await tx.bay.findFirst({
      where: { id: bayId, tenant_id: tenantId, site_id: siteId },
      select: { id: true, is_active: true },
    });

    if (!bay) {
      throw new NotFoundException(`Bay ${bayId} not found`);
    }

    if (!bay.is_active) {
      throw new NotFoundException(`Bay ${bayId} is inactive`);
    }
  }
}
