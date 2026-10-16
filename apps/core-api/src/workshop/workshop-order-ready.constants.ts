/** Idempotency occurrence for the first automatic send when an order becomes COMPLETED. */
export function workshopOrderReadyCompletionOccurrenceId(orderId: string): string {
  return `completed:${orderId}`;
}
