import type { Prisma } from '@prisma/client';

export type TenantMemberListRecord = Prisma.TenantMemberGetPayload<{
  include: { user: true };
}>;

export function mapTenantMember(membership: TenantMemberListRecord) {
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
