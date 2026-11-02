import type { Prisma } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

/** The local user behind the authenticated Firebase session, within the tenant, for audit rows. */
export async function findAuditActorId(
  tx: Prisma.TransactionClient,
  tenantContext: TenantContextService,
  tenantId: string,
): Promise<string | undefined> {
  const authUser = tenantContext.getAuthenticatedUser();
  const actor = authUser?.userId
    ? await tx.user.findFirst({
        where: {
          firebaseUid: authUser.userId,
          active_tenant_id: tenantId,
        },
        select: { id: true },
      })
    : null;
  return actor?.id;
}
