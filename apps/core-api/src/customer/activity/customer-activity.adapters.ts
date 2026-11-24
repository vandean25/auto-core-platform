import { NotificationChannel, NotificationRecipientKind } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { buildRedactedAuditSummary } from './customer-activity.audit-redaction.js';
import { buildActivityKeysetClause } from './customer-activity.cursor.js';
import type {
  CustomerActivityCursor,
  CustomerActivityFetchContext,
  CustomerActivityItem,
  CustomerActivitySourceAdapter,
} from './customer-activity.types.js';

function combineWhere(
  base: Record<string, unknown>,
  keyset: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return keyset ? { AND: [base, keyset] } : base;
}

export function createCustomerActivityAdapters(
  prisma: PrismaService,
): CustomerActivitySourceAdapter[] {
  return [
    createWorkshopOrderAdapter(prisma),
    createSalesOrderAdapter(prisma),
    createInvoiceAdapter(prisma),
    createCreditNoteAdapter(prisma),
    createNotificationOutboxAdapter(prisma),
    createCustomerConsentAdapter(prisma),
    createVehicleNoticeAdapter(prisma),
    createLoanerBookingAdapter(prisma),
    createAuditLogAdapter(prisma),
  ];
}

function createWorkshopOrderAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'workshop_order',
    isPermitted: (access) => access.permissions.has('workshop.order.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause(
        'createdAt',
        'workshop_order',
        cursor,
      );
      const rows = await prisma.workshopOrder.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            customer_id: ctx.customerId,
            site_id: { in: [...ctx.authorizedSiteIds] },
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          order_number: true,
          status: true,
          purpose: true,
          createdAt: true,
          vehicle: { select: { make: true, model: true, plate: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'workshop_order',
        occurred_at: row.createdAt.toISOString(),
        title: row.order_number,
        ref_id: row.id,
        ref_link: `/workshop/orders/${row.id}`,
        summary: {
          status: row.status,
          purpose: row.purpose,
          vehicle: row.vehicle
            ? `${row.vehicle.make} ${row.vehicle.model}${row.vehicle.plate ? ` (${row.vehicle.plate})` : ''}`
            : null,
        },
      }));
    },
  };
}

function createSalesOrderAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'sales_order',
    isPermitted: (access) => access.permissions.has('sales.order.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause(
        'createdAt',
        'sales_order',
        cursor,
      );
      const rows = await prisma.salesOrder.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            customer_id: ctx.customerId,
            site_id: { in: [...ctx.authorizedSiteIds] },
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          order_number: true,
          status: true,
          total_amount: true,
          createdAt: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'sales_order',
        occurred_at: row.createdAt.toISOString(),
        title: row.order_number,
        ref_id: row.id,
        ref_link: `/sales-orders/${row.id}`,
        summary: {
          status: row.status,
          total_amount: Number(row.total_amount),
        },
      }));
    },
  };
}

function createInvoiceAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'invoice',
    isPermitted: (access) => access.permissions.has('invoice.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause('date', 'invoice', cursor);
      const rows = await prisma.invoice.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            customer_id: ctx.customerId,
            OR: [
              { site_id: { in: [...ctx.authorizedSiteIds] } },
              { site_id: null },
            ],
          },
          keyset,
        ),
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          invoice_number: true,
          draft_number: true,
          status: true,
          total_gross: true,
          currency: true,
          date: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'invoice',
        occurred_at: row.date.toISOString(),
        title: row.invoice_number ?? row.draft_number,
        ref_id: row.id,
        ref_link: `/sales/invoices/${row.id}`,
        summary: {
          status: row.status,
          total_gross: Number(row.total_gross),
          currency: row.currency ?? 'EUR',
        },
      }));
    },
  };
}

function createCreditNoteAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'credit_note',
    isPermitted: (access) =>
      access.permissions.has('invoice.read') &&
      access.permissions.has('credit_note.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause(
        'createdAt',
        'credit_note',
        cursor,
      );
      const rows = await prisma.creditNote.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            site_id: { in: [...ctx.authorizedSiteIds] },
            original_invoice: { customer_id: ctx.customerId },
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          credit_number: true,
          status: true,
          total_gross: true,
          reason: true,
          createdAt: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'credit_note',
        occurred_at: row.createdAt.toISOString(),
        title: row.credit_number ?? row.id.slice(0, 8),
        ref_id: row.id,
        ref_link: `/finance/credit-notes/${row.id}`,
        summary: {
          status: row.status,
          total_gross: Number(row.total_gross),
          reason: row.reason,
        },
      }));
    },
  };
}

function createNotificationOutboxAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'email',
    isPermitted: (access) => access.permissions.has('customer.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause('createdAt', 'email', cursor);
      const customerMatchers: Record<string, unknown>[] = [
        {
          workshop_order: {
            customer_id: ctx.customerId,
            site_id: { in: [...ctx.authorizedSiteIds] },
          },
        },
        { source_entity_type: 'Customer', source_entity_id: ctx.customerId },
      ];
      if (ctx.customerEmail) {
        customerMatchers.push({
          recipient_email: { equals: ctx.customerEmail, mode: 'insensitive' },
        });
      }
      const rows = await prisma.notificationOutbox.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            channel: NotificationChannel.EMAIL,
            recipient_kind: NotificationRecipientKind.CUSTOMER,
            OR: customerMatchers,
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          subject: true,
          template_id: true,
          status: true,
          channel: true,
          accepted_at: true,
          createdAt: true,
          workshop_order_id: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'email',
        occurred_at: row.createdAt.toISOString(),
        title: row.subject ?? row.template_id ?? 'E-Mail',
        ref_id: row.id,
        ref_link: row.workshop_order_id
          ? `/workshop/orders/${row.workshop_order_id}`
          : null,
        summary: {
          subject: row.subject,
          template_id: row.template_id,
          status: row.status,
          channel: row.channel,
          sent_at: row.accepted_at ? row.accepted_at.toISOString() : null,
        },
      }));
    },
  };
}

function createCustomerConsentAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'consent',
    isPermitted: (access) => access.permissions.has('customer.consent.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause(
        'occurred_at',
        'consent',
        cursor,
      );
      const rows = await prisma.customerConsent.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            customer_id: ctx.customerId,
          },
          keyset,
        ),
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          purpose: true,
          channel: true,
          status: true,
          occurred_at: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'consent',
        occurred_at: row.occurred_at.toISOString(),
        title: `${row.purpose} (${row.channel})`,
        ref_id: row.id,
        ref_link: `/customers/${ctx.customerId}?tab=consent`,
        summary: {
          purpose: row.purpose,
          channel: row.channel,
          status: row.status,
        },
      }));
    },
  };
}

function createVehicleNoticeAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'vehicle_notice',
    isPermitted: (access) => access.permissions.has('vehicle.read'),
    async fetchItems(
      ctx: CustomerActivityFetchContext,
      cursor: CustomerActivityCursor | null,
      take: number,
    ): Promise<CustomerActivityItem[]> {
      const vehicleIds = await ctx.getVehicleIds();
      if (vehicleIds.length === 0) {
        return [];
      }
      const keyset = buildActivityKeysetClause(
        'createdAt',
        'vehicle_notice',
        cursor,
      );
      const rows = await prisma.vehicleNotice.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            vehicle_id: { in: [...vehicleIds] },
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          vehicle_id: true,
          type: true,
          title: true,
          status: true,
          due_date: true,
          createdAt: true,
          vehicle: { select: { make: true, model: true, plate: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'vehicle_notice',
        occurred_at: row.createdAt.toISOString(),
        title: row.title,
        ref_id: row.id,
        ref_link: `/vehicles/${row.vehicle_id}`,
        summary: {
          notice_type: row.type,
          status: row.status,
          due_date: row.due_date ? row.due_date.toISOString() : null,
          vehicle: `${row.vehicle.make} ${row.vehicle.model}${row.vehicle.plate ? ` (${row.vehicle.plate})` : ''}`,
        },
      }));
    },
  };
}

function createLoanerBookingAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'loaner_booking',
    isPermitted: (access) => access.permissions.has('loaner.booking.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause(
        'createdAt',
        'loaner_booking',
        cursor,
      );
      const rows = await prisma.loanerBooking.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            customer_id: ctx.customerId,
            loaner_vehicle: { site_id: { in: [...ctx.authorizedSiteIds] } },
          },
          keyset,
        ),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          status: true,
          planned_from: true,
          planned_to: true,
          workshop_order_id: true,
          createdAt: true,
          loaner_vehicle: { select: { display_name: true } },
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'loaner_booking',
        occurred_at: row.createdAt.toISOString(),
        title: row.loaner_vehicle.display_name,
        ref_id: row.id,
        ref_link: row.workshop_order_id
          ? `/workshop/orders/${row.workshop_order_id}`
          : '/workshop/loaner-vehicles',
        summary: {
          status: row.status,
          planned_from: row.planned_from.toISOString(),
          planned_to: row.planned_to.toISOString(),
        },
      }));
    },
  };
}

function createAuditLogAdapter(
  prisma: PrismaService,
): CustomerActivitySourceAdapter {
  return {
    type: 'audit',
    isPermitted: (access) => access.permissions.has('customer.read'),
    async fetchItems(ctx, cursor, take): Promise<CustomerActivityItem[]> {
      const keyset = buildActivityKeysetClause('occurred_at', 'audit', cursor);
      const rows = await prisma.auditLog.findMany({
        where: combineWhere(
          {
            tenant_id: ctx.tenantId,
            entity_type: 'Customer',
            entity_id: ctx.customerId,
          },
          keyset,
        ),
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        take,
        select: {
          id: true,
          action: true,
          actor_email: true,
          actor_role: true,
          changed_fields: true,
          redacted_fields: true,
          diff: true,
          occurred_at: true,
        },
      });
      return rows.map((row) => ({
        id: row.id,
        type: 'audit',
        occurred_at: row.occurred_at.toISOString(),
        title: row.action,
        ref_id: row.id,
        ref_link: null,
        summary: buildRedactedAuditSummary(row),
      }));
    },
  };
}
