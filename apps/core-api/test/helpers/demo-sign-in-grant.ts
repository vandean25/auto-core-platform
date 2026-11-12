import type { PrismaService } from '../../src/prisma/prisma.service.js';
import type { SystemPrismaService } from '../../src/prisma/system-prisma.service.js';

/**
 * A DEMO session is only resolved while the user holds a landing demo sign-in grant
 * (otherwise auth returns 401 before any role check). Returns a cleanup that removes it.
 */
export async function grantDemoSignIn(
  systemPrisma: SystemPrismaService,
  prisma: PrismaService,
  firebaseUid: string,
): Promise<() => Promise<void>> {
  const user = await prisma.user.findFirstOrThrow({
    where: { firebaseUid },
    select: { id: true, email: true },
  });
  const accessRequest = await systemPrisma.landingDemoAccessRequest.create({
    data: {
      email: user.email,
      name: 'Demo E2E',
      betrieb: 'E2E',
      consent_recorded_at: new Date(),
    },
    select: { id: true },
  });
  await systemPrisma.landingDemoSignInGrant.create({
    data: {
      access_request_id: accessRequest.id,
      user_id: user.id,
      expires_at: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return async () => {
    await systemPrisma.landingDemoSignInGrant.deleteMany({
      where: { user_id: user.id },
    });
    await systemPrisma.landingDemoAccessRequest.delete({
      where: { id: accessRequest.id },
    });
  };
}
