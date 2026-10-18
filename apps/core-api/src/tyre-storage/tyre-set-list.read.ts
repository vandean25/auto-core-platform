import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TyreSetListQueryDto } from './dto/tyre-set-list-query.dto.js';
import {
  buildTyreSetListWhere,
  type TyreSetListQuery,
  tyreSetListSkipOffset,
} from './tyre-set-list.query.js';

type TyreSetListRow = Prisma.TyreSetGetPayload<{
  include: {
    customer: {
      select: {
        first_name: true;
        last_name: true;
        phone: true;
        email: true;
      };
    };
    vehicle: { select: { plate: true } };
    location: { select: { code: true } };
  };
}>;

const tyreSetListInclude = {
  customer: {
    select: {
      first_name: true,
      last_name: true,
      phone: true,
      email: true,
    },
  },
  vehicle: { select: { plate: true } },
  location: { select: { code: true } },
} satisfies Prisma.TyreSetInclude;

/** Paginated tyre-set list (REST page index or MCP row skip). */
export async function queryTyreSetsForList<T>(
  prisma: Pick<PrismaService, '$transaction' | 'tyreSet'>,
  tenantId: string,
  siteId: string,
  query: TyreSetListQueryDto | TyreSetListQuery,
  toResponse: (row: TyreSetListRow) => T,
): Promise<{
  data: T[];
  meta: { total: number; page: number; pageSize: number; pageCount: number };
}> {
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize =
    query.pageSize && query.pageSize > 0 ? Math.min(query.pageSize, 100) : 25;
  const skip = tyreSetListSkipOffset(query, pageSize);
  const where = buildTyreSetListWhere(tenantId, siteId, query);

  const [total, rows] = await prisma.$transaction([
    prisma.tyreSet.count({ where }),
    prisma.tyreSet.findMany({
      where,
      include: tyreSetListInclude,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map((row) => toResponse(row)),
    meta: {
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
