export const WORKSHOP_ORDER_ID_KEYS = [
  'order_id',
  'orderId',
  'workshop_order_id',
  'workshopOrderId',
] as const;

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isWorkshopOrderLineAction(actionType: string): boolean {
  return (
    actionType === 'workshop_order.add_line' ||
    actionType === 'workshop_order.propose_line'
  );
}

export function resolveWorkshopOrderId(
  actionType: string,
  payload: Record<string, unknown>,
): string | null {
  if (
    actionType === 'workshop_order.mechanic_finding' &&
    typeof payload.workshop_order_id === 'string'
  ) {
    return payload.workshop_order_id;
  }
  if (!isWorkshopOrderLineAction(actionType)) {
    return null;
  }
  for (const key of WORKSHOP_ORDER_ID_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return null;
}

export function getOriginatingAgentId(payload: unknown): string | undefined {
  if (!isPlainRecord(payload)) {
    return undefined;
  }
  const agentId = payload.agent_id ?? payload.agentId;
  return typeof agentId === 'string' && agentId.length > 0
    ? agentId
    : undefined;
}

/** Site the workshop-order simulation ran in, read from the stored preview. */
export function readExecutionSiteId(preview: unknown): string | undefined {
  const executionContext = isPlainRecord(preview)
    ? preview.execution_context
    : undefined;
  if (!isPlainRecord(executionContext)) {
    return undefined;
  }
  return typeof executionContext.site_id === 'string'
    ? executionContext.site_id
    : undefined;
}

/** Pending actions that must run in the site stored on the simulation preview. */
export const SITE_BOUND_PENDING_ACTION_TYPES = new Set<string>([
  'workshop_order.create',
  'registration_intake.apply',
  'workshop.booking_package',
  'purchase_order.propose_draft',
  'workshop_order.complete',
  'invoice.create_draft_from_workshop_order',
  'workshop_estimate.send',
  'estimate.send_customer_message',
  'workshop_order.mechanic_finding',
]);

export function isSiteBoundPendingAction(actionType: string): boolean {
  return SITE_BOUND_PENDING_ACTION_TYPES.has(actionType);
}

export function siteBoundExecutionContext(
  actionType: string,
  preview: unknown,
): { site_id: string } | undefined {
  if (!isSiteBoundPendingAction(actionType)) {
    return undefined;
  }
  const siteId = readExecutionSiteId(preview);
  return siteId ? { site_id: siteId } : undefined;
}
