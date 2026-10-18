export {
  OPEN_WORKSHOP_ORDER_STATUSES,
  REQUISITION_SLICE_STATUSES,
  ZERO,
  type RequisitionCatalogItemWithBrand,
  type RequisitionCandidateLine,
  type RequisitionDetail,
  type RequisitionDetailLine,
  type ReservationRow,
  type ShortageLine,
} from './parts-requisition-lifecycle.types.js';

export { assertBackOfficeAccess } from './parts-requisition-lifecycle.access.js';

export {
  lockRequisitionLine,
  lockRequisitionLines,
  lockRequisitionReservations,
  lockRequisitionRows,
  lockRequisitionStock,
  lockRequisitionTask,
  lockRequisitionTasks,
} from './parts-requisition-lifecycle.locking.js';

export {
  findAuthorizedLine,
  findAuthorizedSourceLocation,
  findLineReservations,
  findRequisitionCandidateLines,
} from './parts-requisition-lifecycle.queries.js';

export {
  assertLineAllocationFits,
  assertUniqueSelections,
  groupReservationsByLine,
  validateRequisitionPoItems,
} from './parts-requisition-lifecycle.validation.js';

export {
  loadRequisitionResponse,
  toRequisitionResponse,
  toReservationResponse,
  toShortageResponse,
} from './parts-requisition-lifecycle.mappers.js';

export {
  executeCreatePurchaseOrderForRequisition,
  executeCreateRequisitionPurchaseOrder,
} from './parts-requisition-lifecycle.purchase-order.js';

export {
  cancelReservationRecord,
  executeReleaseReservation,
  handleToteReturnStock,
  loadAndLockReservationForRelease,
  releaseOnHandReservationCommitment,
  releaseStagedReservationStock,
  syncLineItemStatusAfterRelease,
  syncRequisitionAfterRelease,
} from './parts-requisition-lifecycle.release.js';

export { executeConsumeReservation } from './parts-requisition-lifecycle.consume.js';

export {
  executeCreateOnHandReservation,
  executeCreateRequisitionSheet,
  incrementTaskVersions,
} from './parts-requisition-lifecycle.create.js';

export { fetchShortages } from './parts-requisition-lifecycle.shortages.js';
