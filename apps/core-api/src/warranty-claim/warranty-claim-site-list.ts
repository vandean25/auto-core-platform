import type {
  Prisma,
  WarrantyClaimStatus,
  WarrantyClaimType,
} from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  toWarrantyClaimResponse,
  type WarrantyClaimResponse,
} from './warranty-claim.mapper.js';

const claimInclude = (tenantId: string) =>
  ({
    lines: {
      where: { tenant_id: tenantId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    },
  }) satisfies Prisma.WarrantyClaimInclude;

export type WarrantyClaimSiteListParams = {
  workshopOrderId?: string;
  statuses?: WarrantyClaimStatus[];
  type?: WarrantyClaimType;
  pageSize: number;
  cursorCreatedAt?: Date;
  cursorId?: string;
};

function siteListBaseWhere(
  tenantId: string,
  siteId: string,
  params: WarrantyClaimSiteListParams,
): Prisma.WarrantyClaimWhereInput {
  const orderScope: Prisma.WorkshopOrderWhereInput = {
    tenant_id: tenantId,
    site_id: siteId,
    ...(params.workshopOrderId ? { id: params.workshopOrderId } : {}),
  };
  return {
    tenant_id: tenantId,
    workshop_order: orderScope,
    ...(params.statuses && params.statuses.length > 0
      ? { status: { in: params.statuses } }
      : {}),
    ...(params.type ? { type: params.type } : {}),
  };
}

function siteListCursorWhere(
  params: WarrantyClaimSiteListParams,
): Prisma.WarrantyClaimWhereInput | undefined {
  if (!params.cursorCreatedAt || !params.cursorId) {
    return undefined;
  }
  return {
    OR: [
      { createdAt: { lt: params.cursorCreatedAt } },
      {
        createdAt: params.cursorCreatedAt,
        id: { lt: params.cursorId },
      },
    ],
  };
}

/** Site-scoped claim list with keyset paging (createdAt desc, id desc). */
export async function listWarrantyClaimsAtActiveSite(
  prisma: Pick<PrismaService, 'warrantyClaim'>,
  tenantId: string,
  siteId: string,
  params: WarrantyClaimSiteListParams,
): Promise<{ rows: WarrantyClaimResponse[]; total: number }> {
  const baseWhere = siteListBaseWhere(tenantId, siteId, params);
  const cursorWhere = siteListCursorWhere(params);
  const where: Prisma.WarrantyClaimWhereInput = cursorWhere
    ? { AND: [baseWhere, cursorWhere] }
    : baseWhere;

  const [total, rows] = await Promise.all([
    prisma.warrantyClaim.count({ where: baseWhere }),
    prisma.warrantyClaim.findMany({
      where,
      include: claimInclude(tenantId),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: params.pageSize + 1,
    }),
  ]);

  return {
    rows: rows.map((row) => toWarrantyClaimResponse(row)),
    total,
  };
}
