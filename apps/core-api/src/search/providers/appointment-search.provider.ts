import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  collectSiteRanked,
  tierFilter,
  tiersFor,
  type MatchTier,
  type ScoredRow,
} from '../search-ranking.js';
import type {
  ParsedSearchQuery,
  SearchContext,
  SearchProvider,
  SearchResult,
} from '../search.types.js';
import { customerMatchWhere } from './customer-match.js';
import { customerLabel, joinParts } from './search-format.js';
import { vehicleMatchWhere } from './vehicle-match.js';

const SELECT = {
  id: true,
  order_number: true,
  site_id: true,
  scheduled_start_at: true,
  customer: {
    select: { first_name: true, last_name: true, company_name: true },
  },
  vehicle: { select: { make: true, model: true, plate: true } },
} as const;
const ORDER_BY: Prisma.WorkshopOrderOrderByWithRelationInput[] = [
  { scheduled_start_at: 'desc' },
  { id: 'asc' },
];
const DATE_FORMAT = new Intl.DateTimeFormat('de-AT', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'Europe/Vienna',
});

type AppointmentRow = {
  id: string;
  order_number: string;
  site_id: string | null;
  scheduled_start_at: Date | null;
  customer: {
    first_name: string;
    last_name: string;
    company_name: string | null;
  } | null;
  vehicle: { make: string; model: string; plate: string | null };
};

function matchWhere(
  tenantId: string,
  query: ParsedSearchQuery,
  tier: MatchTier,
  restricted: boolean,
): Prisma.WorkshopOrderWhereInput | null {
  const or: Prisma.WorkshopOrderWhereInput[] = [];
  if (query.kind === 'uuid') or.push({ id: query.text.toLowerCase() });
  if (query.kind === 'number') {
    or.push({ order_number: tierFilter(tier, query.text) });
  }
  const vehicle = vehicleMatchWhere(query, tier);
  if (vehicle) or.push({ vehicle: { ...vehicle, tenant_id: tenantId } });
  const customer = customerMatchWhere(query, tier, restricted);
  if (customer) or.push({ customer: { ...customer, tenant_id: tenantId } });
  return or.length > 0 ? { OR: or } : null;
}

function toResult({ row, score }: ScoredRow<AppointmentRow>): SearchResult {
  const scheduled = row.scheduled_start_at
    ? DATE_FORMAT.format(new Date(row.scheduled_start_at))
    : null;
  return {
    type: 'appointment',
    id: row.id,
    title: row.order_number,
    subtitle: joinParts([
      scheduled,
      row.customer ? customerLabel(row.customer) : null,
      row.vehicle.plate,
    ]),
    href: `/workshop/orders/${row.id}`,
    score,
    ...(row.site_id ? { siteId: row.site_id } : {}),
  };
}

/** Scheduled workshop orders (appointments). TECH sees them with customer contact fields redacted. */
export class AppointmentSearchProvider implements SearchProvider {
  readonly type = 'appointment';
  readonly allowedRoles = ['OWNER', 'ADMIN', 'SALES', 'TECH', 'DEMO'] as const;

  constructor(private readonly prisma: PrismaService) {}

  async search(ctx: SearchContext): Promise<SearchResult[]> {
    const restricted = ctx.role === 'TECH';
    const rows = await collectSiteRanked<AppointmentRow>(
      ctx.limit,
      await ctx.getSiteScope(),
      async (tier, siteIds) => {
        const match = matchWhere(ctx.tenantId, ctx.query, tier, restricted);
        if (!match) return [];
        return this.prisma.workshopOrder.findMany({
          where: {
            AND: [match, { scheduled_start_at: { not: null } }],
            tenant_id: ctx.tenantId,
            site_id: { in: siteIds },
          },
          select: SELECT,
          orderBy: ORDER_BY,
          take: ctx.limit,
        });
      },
      tiersFor(ctx.query),
    );
    return rows.map(toResult);
  }
}
