import { readExecutionSiteId } from './agent-proposal-payload.js';

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
