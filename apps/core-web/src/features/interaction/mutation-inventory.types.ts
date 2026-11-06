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

/** Hooks whose inventory classification is not yet matched by runtime (still use optimisticMutationOptions). */
export type UnmigratedOptimisticConsumerEntry = {
  operationId: string
  owningHook: string
  note?: string
}

export type UnmigratedOptimisticConsumersBaselineDocument = {
  schemaVersion: 1
  module: 'workshop-orders-and-mechanic-queue'
  entries: UnmigratedOptimisticConsumerEntry[]
}

/** Inventory entry for a module outside the AUT-894 pilot; `sourceFile` disambiguates equal hook names. */
export type MutationInventoryEntry = WorkshopMutationInventoryEntry & {
  sourceFile?: string
}

/** Entries for modules beyond the work-order pilot, grown module by module (ADR-0036 R1). */
export type MutationInventoryExtensionDocument = {
  schemaVersion: 1
  entries: MutationInventoryEntry[]
}
