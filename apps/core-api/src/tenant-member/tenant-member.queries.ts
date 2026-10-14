import type { Prisma } from '@prisma/client';
import type { ListTenantMembersQueryDto } from './dto/tenant-member.dto.js';

export interface TenantMemberListPagination {
  page: number;
  limit: number;
  skip: number;
}

export function resolveTenantMemberPagination(
  query: ListTenantMembersQueryDto,
): TenantMemberListPagination {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 25));

  return { page, limit, skip: (page - 1) * limit };
}

export function buildTenantMemberWhere(
  tenantId: string,
  query: ListTenantMembersQueryDto,
): Prisma.TenantMemberWhereInput {
  const search = query.search?.trim();

  return {
    tenant_id: tenantId,
    ...(query.includeInactive ? {} : { is_active: true }),
    ...(search ? { OR: buildSearchClauses(search) } : {}),
  };
}

export function buildTenantMemberListMeta(
  total: number,
  page: number,
  limit: number,
) {
  return {
    total,
    page,
    limit,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function buildSearchClauses(search: string): Prisma.TenantMemberWhereInput[] {
  return [
    { user: { is: { email: { contains: search, mode: 'insensitive' } } } },
    { user: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
    { user: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
  ];
}
