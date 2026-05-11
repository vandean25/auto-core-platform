import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { UserRecord } from 'firebase-admin/auth';
import { getFirebaseAdminAuth } from '../auth/firebase-admin';
import { TenantContextService } from '../common/services/tenant-context.service';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import {
  InviteTenantMemberDto,
  ListTenantMembersQueryDto,
  UpdateTenantMemberDto,
} from './dto/tenant-member.dto';

type TenantMemberListRecord = Prisma.TenantMemberGetPayload<{
  include: { user: true };
}>;

type UserProjectionRecord = Prisma.UserGetPayload<{
  include: {
    platformAdmin: true;
    memberships: true;
  };
}>;

@Injectable()
export class TenantMemberService {
  constructor(
    private readonly systemPrisma: SystemPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
  ) {}

  async findAll(query: ListTenantMembersQueryDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;
    const where = this.buildTenantMemberWhere(tenantId, query);

    const [memberships, total] = await Promise.all([
      this.systemPrisma.tenantMember.findMany({
        where,
        include: { user: true },
        orderBy: [{ createdAt: 'asc' }],
        skip,
        take: limit,
      }),
      this.systemPrisma.tenantMember.count({ where }),
    ]);

    return {
      data: memberships.map((membership) => this.mapTenantMember(membership)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async invite(dto: InviteTenantMemberDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const normalizedEmail = dto.email.trim().toLowerCase();
    const firebaseUser = await this.resolveFirebaseUser(normalizedEmail);
    const resolvedEmail = (firebaseUser.email ?? normalizedEmail)
      .trim()
      .toLowerCase();

    const existingUser = await this.systemPrisma.user.findFirst({
      where: {
        OR: [{ firebaseUid: firebaseUser.uid }, { email: resolvedEmail }],
      },
    });

    let userId: string;
    let hasActiveTenant = false;

    if (existingUser) {
      userId = existingUser.id;
      hasActiveTenant = Boolean(existingUser.active_tenant_id);

      await this.systemPrisma.user.update({
        where: { id: existingUser.id },
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
        },
      });
    } else {
      const createdUser = await this.systemPrisma.user.create({
        data: {
          firebaseUid: firebaseUser.uid,
          email: resolvedEmail,
        },
      });

      userId = createdUser.id;
      hasActiveTenant = Boolean(createdUser.active_tenant_id);
    }

    if (!hasActiveTenant) {
      await this.systemPrisma.user.update({
        where: { id: userId },
        data: { active_tenant_id: tenantId },
      });
    }

    const membership = await this.systemPrisma.tenantMember.upsert({
      where: {
        tenant_id_user_id: {
          tenant_id: tenantId,
          user_id: userId,
        },
      },
      update: {
        role: dto.role,
        is_active: true,
      },
      create: {
        tenant_id: tenantId,
        user_id: userId,
        role: dto.role,
        is_active: true,
      },
      include: { user: true },
    });

    await this.syncUserClaims(userId);
    this.dashboardRealtime.emitClaimsUpdated(firebaseUser.uid);

    return this.mapTenantMember(membership);
  }

  async update(id: string, dto: UpdateTenantMemberDto) {
    this.assertTenantAdminAccess();

    const tenantId = this.tenantContext.getRequiredTenantId();
    const existingMembership = await this.systemPrisma.tenantMember.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
      include: { user: true },
    });

    if (!existingMembership) {
      throw new BadRequestException(`Tenant member ${id} not found.`);
    }

    const updatedMembership = await this.systemPrisma.tenantMember.update({
      where: { id },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.isActive !== undefined && { is_active: dto.isActive }),
      },
      include: { user: true },
    });

    const securitySensitiveChange =
      (dto.role !== undefined && dto.role !== existingMembership.role) ||
      dto.isActive === false;

    await this.syncUserClaims(updatedMembership.user_id);

    const updatedUser = await this.systemPrisma.user.findFirst({
      where: { id: updatedMembership.user_id },
      select: { firebaseUid: true },
    });

    if (securitySensitiveChange && updatedUser?.firebaseUid) {
      await this.getFirebaseAuth().revokeRefreshTokens(updatedUser.firebaseUid);
    }

    if (updatedUser?.firebaseUid) {
      this.dashboardRealtime.emitClaimsUpdated(updatedUser.firebaseUid);
    }

    return this.mapTenantMember(updatedMembership);
  }

  protected getFirebaseAuth() {
    return getFirebaseAdminAuth();
  }

  private async resolveFirebaseUser(email: string): Promise<UserRecord> {
    const firebaseAuth = this.getFirebaseAuth();

    try {
      return await firebaseAuth.getUserByEmail(email);
    } catch (error) {
      if (this.getFirebaseErrorCode(error) === 'auth/user-not-found') {
        return firebaseAuth.createUser({ email });
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(
        `Failed to resolve Firebase user for ${email}: ${message}`,
      );
    }
  }

  private async syncUserClaims(userId: string): Promise<void> {
    const user = (await this.systemPrisma.user.findFirst({
      where: { id: userId },
      include: {
        platformAdmin: true,
        memberships: {
          where: {
            is_active: true,
            tenant: { is_active: true },
          },
          orderBy: [{ createdAt: 'asc' }],
        },
      },
    })) as UserProjectionRecord | null;

    if (!user) {
      throw new BadRequestException(
        `Unable to project claims for user ${userId}.`,
      );
    }

    const activeMembership =
      user.memberships.find(
        (membership) => membership.tenant_id === user.active_tenant_id,
      ) ??
      user.memberships[0] ??
      null;

    if (
      (user.active_tenant_id ?? null) !== (activeMembership?.tenant_id ?? null)
    ) {
      await this.systemPrisma.user.update({
        where: { id: user.id },
        data: { active_tenant_id: activeMembership?.tenant_id ?? null },
      });
    }

    const firebaseAuth = this.getFirebaseAuth();
    const firebaseUser = await firebaseAuth.getUser(user.firebaseUid);
    const nextClaims = {
      ...(firebaseUser.customClaims ?? {}),
    } as Record<string, unknown>;

    delete nextClaims.tenantId;
    delete nextClaims.role;
    delete nextClaims.platformRole;

    if (activeMembership) {
      nextClaims.tenantId = activeMembership.tenant_id;
      nextClaims.role = activeMembership.role;
    }

    if (user.platformAdmin?.is_active) {
      nextClaims.platformRole = user.platformAdmin.role;
    }

    await firebaseAuth.setCustomUserClaims(user.firebaseUid, nextClaims);
  }

  private buildTenantMemberWhere(
    tenantId: string,
    query: ListTenantMembersQueryDto,
  ): Prisma.TenantMemberWhereInput {
    const search = query.search?.trim();

    return {
      tenant_id: tenantId,
      ...(query.includeInactive ? {} : { is_active: true }),
      ...(search
        ? {
            OR: [
              {
                user: {
                  is: {
                    email: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                user: {
                  is: {
                    firstName: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                user: {
                  is: {
                    lastName: { contains: search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
  }

  private assertTenantAdminAccess(): void {
    const user = this.tenantContext.getAuthenticatedUser();

    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  private mapTenantMember(membership: TenantMemberListRecord) {
    return {
      id: membership.id,
      tenantId: membership.tenant_id,
      userId: membership.user_id,
      email: membership.user.email,
      firstName: membership.user.firstName,
      lastName: membership.user.lastName,
      role: membership.role,
      isActive: membership.is_active,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  }

  private getFirebaseErrorCode(error: unknown): string | undefined {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string'
    ) {
      return (error as { code: string }).code;
    }

    return undefined;
  }
}
