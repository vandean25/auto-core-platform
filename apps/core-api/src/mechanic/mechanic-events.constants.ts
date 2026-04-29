/**
 * Event emitted when a WorkshopTask transitions to WAITING_CUSTOMER.
 * Service Advisors subscribe to this event to trigger the standard
 * outbound contact notification flow (email / SMS).
 *
 * ADR-0014 §4.3 — notifications must not be sent directly from the
 * mutation handler.
 */
export const TASK_WAITING_CUSTOMER_EVENT = 'task.waiting_customer';

export interface TaskWaitingCustomerPayload {
  tenantId: string;
  taskId: string;
  orderId: string;
  /** Employee ID of the mechanic who triggered the pause */
  mechanicId: string;
}
