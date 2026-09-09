import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

type TenantScopedPrisma = Pick<
  PrismaService,
  'customer' | 'vehicle' | 'catalogItem'
>;

export async function assertCustomerBelongsToTenant(
  prisma: TenantScopedPrisma,
  customerId: string,
  tenantId: string,
): Promise<void> {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenant_id: tenantId },
  });
  if (!customer) {
    throw new BadRequestException(
      'Customer not found or belongs to another tenant',
    );
  }
}

export async function assertVehicleBelongsToTenant(
  prisma: TenantScopedPrisma,
  vehicleId: string,
  tenantId: string,
): Promise<void> {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, tenant_id: tenantId },
  });
  if (!vehicle) {
    throw new BadRequestException(
      'Vehicle not found or belongs to another tenant',
    );
  }
}

export async function assertCatalogItemsBelongToTenant(
  prisma: TenantScopedPrisma,
  catalogItemIds: string[],
  tenantId: string,
  errorMessage = 'One or more catalog items not found or belong to another tenant',
): Promise<void> {
  if (catalogItemIds.length === 0) {
    return;
  }

  const uniqueIds = [...new Set(catalogItemIds)];
  const count = await prisma.catalogItem.count({
    where: { id: { in: uniqueIds }, tenant_id: tenantId },
  });
  if (count !== uniqueIds.length) {
    throw new BadRequestException(errorMessage);
  }
}
