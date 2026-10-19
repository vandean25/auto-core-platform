import { Prisma, WorkshopEstimateStatus } from '@prisma/client';

export type SiteEstimateVersionListRow = {
  id: string;
  version: number;
  status: WorkshopEstimateStatus;
  valid_until: Date | null;
  sent_at: Date | null;
  decided_at: Date | null;
  channel: string | null;
  total_net: Prisma.Decimal | null;
  total_gross: Prisma.Decimal | null;
  estimate: {
    estimate_number: string;
    workshop_order_id: string;
    site_id: string;
    workshop_order: {
      customer_id: string | null;
      order_number: string;
    };
  };
};

export type ListSiteEstimateVersionsFilters = {
  customerId?: string;
  orderId?: string;
  status?: WorkshopEstimateStatus;
  sentFrom?: string;
  sentTo?: string;
  timeZone: string;
};

export type ListSiteEstimateVersionsPageRequest =
  ListSiteEstimateVersionsFilters & {
    pageSize: number;
    cursor?: string;
  };

export type ListSiteEstimateVersionsPage = {
  rows: SiteEstimateVersionListRow[];
  nextCursor: string | null;
};
