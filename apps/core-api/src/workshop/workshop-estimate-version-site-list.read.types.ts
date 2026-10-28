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
      customer: {
        company_name: string | null;
        first_name: string;
        last_name: string;
      } | null;
      vehicle: { plate: string | null };
    };
  };
};

export type ListSiteEstimateVersionsFilters = {
  customerId?: string;
  orderId?: string;
  status?: WorkshopEstimateStatus;
  sentFrom?: string;
  sentTo?: string;
  /**
   * Leaves out versions that a newer version has replaced, so each estimate shows only its current version. It
   * only applies when no `status` is given; an explicit status (including SUPERSEDED) is always honoured.
   */
  excludeSuperseded?: boolean;
  timeZone: string;
};

export type ListSiteEstimateVersionsPageRequest =
  ListSiteEstimateVersionsFilters & {
    pageSize: number;
    cursor?: string;
  };
