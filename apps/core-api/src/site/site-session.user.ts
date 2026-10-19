import type { PrismaService } from '../prisma/prisma.service.js';
import type { SiteContextUser } from './site-session.types.js';

export async function resolveSiteContextUser(
  prisma: PrismaService,
  tenantId: string,
  firebaseUid: string | undefined,
): Promise<SiteContextUser | null> {
  if (!firebaseUid) {
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { firebaseUid },
    select: { id: true, firebaseUid: true, active_site_id: true },
  });
  if (!user?.firebaseUid) {
    return null;
  }
  const member = await prisma.tenantMember.findFirst({
    where: { tenant_id: tenantId, user_id: user.id, is_active: true },
    select: { id: true },
  });
  return member ? { ...user, firebaseUid: user.firebaseUid } : null;
}
