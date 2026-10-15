import { Injectable, UnauthorizedException } from '@nestjs/common';
import { TenantMemberRole } from '@prisma/client';
import { SystemPrismaService } from '../prisma/system-prisma.service.js';

@Injectable()
export class LandingDemoSignInGrantService {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async assertDemoSignInGrantForSession(
    userId: string,
    now = new Date(),
  ): Promise<void> {
    const activeGrant =
      await this.systemPrisma.landingDemoSignInGrant.findFirst({
        where: {
          user_id: userId,
          invalidated_at: null,
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          consumed_at: true,
          expires_at: true,
        },
      });

    if (!activeGrant) {
      throw new UnauthorizedException(
        'Demo sign-in link is missing, expired, or already used.',
      );
    }

    if (activeGrant.consumed_at) {
      return;
    }

    if (activeGrant.expires_at.getTime() <= now.getTime()) {
      throw new UnauthorizedException(
        'Demo sign-in link is missing, expired, or already used.',
      );
    }

    const consumed = await this.systemPrisma.landingDemoSignInGrant.updateMany({
      where: {
        id: activeGrant.id,
        consumed_at: null,
        invalidated_at: null,
        expires_at: { gt: now },
      },
      data: { consumed_at: now },
    });

    if (consumed.count !== 1) {
      throw new UnauthorizedException(
        'Demo sign-in link is missing, expired, or already used.',
      );
    }
  }

  async userHasNonDemoActiveMembership(userId: string): Promise<boolean> {
    const count = await this.systemPrisma.tenantMember.count({
      where: {
        user_id: userId,
        is_active: true,
        role: { not: TenantMemberRole.DEMO },
        tenant: { is_active: true },
      },
    });
    return count > 0;
  }
}
