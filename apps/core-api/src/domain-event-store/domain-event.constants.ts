/** Stable event type strings for the domain event store (AUT-536). */
export const DOMAIN_EVENT_TYPES = {
  workshopOrderScheduledV1: 'workshop_order.scheduled.v1',
  workshopEstimateDecidedV1: 'workshop_estimate.decided.v1',
  workshopOrderReadyV1: 'workshop_order.ready.v1',
} as const;

export const DOMAIN_EVENT_SCHEMA_VERSION = 1;

export const DOMAIN_EVENT_CURSOR_VERSION = 1;
