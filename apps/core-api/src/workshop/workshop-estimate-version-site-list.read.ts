import type { PrismaService } from '../prisma/prisma.service.js';
import type { EstimateScope } from './workshop-estimate-scope.js';
import { querySiteEstimateVersionsPage } from './workshop-estimate-version-site-list.read.query.js';
import type { ListSiteEstimateVersionsPageRequest } from './workshop-estimate-version-site-list.read.types.js';

export type {
  ListSiteEstimateVersionsFilters,
  ListSiteEstimateVersionsPageRequest,
  SiteEstimateVersionListRow,
} from './workshop-estimate-version-site-list.read.types.js';

export async function listSiteEstimateVersionsPage(
  prisma: PrismaService,
  scope: EstimateScope,
  request: ListSiteEstimateVersionsPageRequest,
  now?: Date,
) {
  return querySiteEstimateVersionsPage(prisma, scope, request, now);
}
