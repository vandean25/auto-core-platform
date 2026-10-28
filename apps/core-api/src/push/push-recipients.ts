import {
  EmployeeRole,
  type NotificationEventType,
  type Prisma,
} from '@prisma/client';

export interface PushRecipientQuery {
  tenantId: string;
  siteId: string;
  eventType: NotificationEventType;
  /** Employees (for example the assigned mechanics) who get the push besides the service advisors. */
  extraEmployeeIds?: string[];
}

/**
 * The staff users who get a push for an order event (ADR-0033 §3), resolved when the event is written: the active
 * service advisors, plus any extra employees, who are active members of the tenant and of the order's site and who
 * switched this event on. The sender checks membership again at send time. Reads only, in the caller's transaction.
 */
export async function resolvePushRecipients(
  tx: Prisma.TransactionClient,
  query: PushRecipientQuery,
): Promise<string[]> {
  const { tenantId, siteId, eventType } = query;
  // Most tenants have nobody opted in, so the cheapest query goes first and ends the work.
  const optedIn = await tx.pushPreference.findMany({
    where: { tenant_id: tenantId, enabled_events: { has: eventType } },
    select: { user_id: true },
  });
  if (optedIn.length === 0) return [];

  const employees = await tx.employee.findMany({
    where: {
      tenant_id: tenantId,
      is_active: true,
      user_id: { in: optedIn.map((preference) => preference.user_id) },
      OR: [
        { role: EmployeeRole.SERVICE_ADVISOR },
        { id: { in: query.extraEmployeeIds ?? [] } },
      ],
    },
    select: { user_id: true },
  });
  const userIds = employees.flatMap((employee) =>
    employee.user_id ? [employee.user_id] : [],
  );
  if (userIds.length === 0) return [];

  const memberships = await tx.siteMembership.findMany({
    where: {
      tenant_id: tenantId,
      site_id: siteId,
      is_active: true,
      user_id: { in: userIds },
      tenantMember: { is_active: true },
    },
    select: { user_id: true },
  });
  return [...new Set(memberships.map((membership) => membership.user_id))];
}
