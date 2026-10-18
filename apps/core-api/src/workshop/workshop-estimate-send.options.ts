/** Whether the send also emails the approval link to the customer (ADR-0025 §5 to §8). */
export interface EstimateSendOptions {
  notifyCustomerByEmail: boolean;
  /** When set, overrides the default 14-day validity end (must be after valid_from). */
  validUntilOverride?: Date;
}
