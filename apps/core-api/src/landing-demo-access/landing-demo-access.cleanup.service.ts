import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TenantMemberRole } from '@prisma/client';
import { getFirebaseAdminAuth } from '../auth/firebase-admin.js';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

@Injectable()
export class LandingDemoAccessCleanupService {
  private readonly logger = new Logger(LandingDemoAccessCleanupService.name);

  constructor(private readonly systemPrisma: SystemPrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async deactivateExpiredDemoMemberships(): Promise<void> {
    const now = new Date();
    const expired = await this.systemPrisma.tenantMember.findMany({
      where: {
        role: TenantMemberRole.DEMO,
        is_active: true,
        demo_access_expires_at: { lte: now },
      },
      include: {
        user: { select: { id: true, firebaseUid: true } },
      },
      take: 200,
    });

    if (expired.length === 0) {
      return;
    }

    const firebaseAuth = getFirebaseAdminAuth();
    for (const membership of expired) {
      await this.systemPrisma.tenantMember.update({
        where: { id: membership.id },
        data: { is_active: false },
      });

      const uid = membership.user.firebaseUid;
      if (uid) {
        try {
          await firebaseAuth.updateUser(uid, { disabled: true });
        } catch (error) {
          this.logger.warn(
            `Could not disable Firebase user ${uid} after demo expiry: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    await this.systemPrisma.publicRateLimitCounter.deleteMany({
      where: { expires_at: { lte: now } },
    });

    this.logger.log(`Deactivated ${expired.length} expired demo memberships.`);
  }
}
