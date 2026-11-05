export type MutationClassification = 'optimistic' | 'server-confirmed' | 'conditional'

export type WorkshopMutationInventoryEntry = {
  operationId: string
  owningHook: string
  classification: MutationClassification
  /** Required when classification is server-confirmed. */
  serverConfirmedReason?: string
  /** Module export tested for conditional eligibility (ADR-0036 R1). */
  eligibilityPredicate?: string
}

export type WorkshopMutationInventoryDocument = {
  schemaVersion: 1
  module: 'workshop-orders-and-mechanic-queue'
  entries: WorkshopMutationInventoryEntry[]
}

export type MutationKeyBaselineDocument = {
  schemaVersion: 1
  module: 'workshop-orders-and-mechanic-queue'
  /** Owning hooks whose useMutation options still omit mutationKey (shrinks as hooks migrate). */
  missingMutationKey: string[]
}
