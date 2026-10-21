import type { PrismaService } from '../prisma/prisma.service.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  measurementImportForbidden,
  measurementReadForbidden,
} from './inspection-measurement.errors.js';

const WRITE_ROLES = new Set(['OWNER', 'ADMIN', 'SALES']);
const READ_ROLES = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
  'MECHANIC',
  'SERVICE_ADVISOR',
  'PARTS_CLERK',
  'TECH',
]);

export function assertMeasurementReadAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !READ_ROLES.has(role)) {
    throw measurementReadForbidden();
  }
}

export function hasMeasurementWriteRole(
  tenantContext: TenantContextService,
): boolean {
  const role = tenantContext.getAuthenticatedUser()?.role;
  return Boolean(role && WRITE_ROLES.has(role));
}

export async function assertMechanicMeasurementOrderAccess(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  order: {
    id: string;
    mechanic_id: string | null;
    tasks: Array<{ mechanic_id: string | null }>;
  },
): Promise<void> {
  const user = tenantContext.getAuthenticatedUser();
  if (!user || user.role !== 'TECH') {
    throw measurementImportForbidden();
  }

  const employee = await prisma.employee.findFirst({
    where: {
      tenant_id: tenantId,
      role: 'MECHANIC',
      is_active: true,
      user: {
        OR: [{ firebaseUid: user.userId }, { email: user.email }],
      },
    },
    select: { id: true },
  });
  if (!employee) {
    throw measurementImportForbidden();
  }

  if (order.mechanic_id === employee.id) {
    return;
  }
  const taskAssigned = order.tasks.some(
    (task) => task.mechanic_id === employee.id,
  );
  if (taskAssigned) {
    return;
  }
  throw measurementImportForbidden();
}

export async function assertMeasurementWriteAccess(
  prisma: PrismaService,
  tenantContext: TenantContextService,
  tenantId: string,
  order: {
    id: string;
    mechanic_id: string | null;
    tasks: Array<{ mechanic_id: string | null }>;
  },
): Promise<void> {
  if (hasMeasurementWriteRole(tenantContext)) {
    return;
  }
  await assertMechanicMeasurementOrderAccess(
    prisma,
    tenantContext,
    tenantId,
    order,
  );
}
