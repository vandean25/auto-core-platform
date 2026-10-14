import {
  DECISION_POLICY_ACTION_TYPES,
  type DocumentSortType,
} from './decision.constants.js';

/**
 * Logger context of the live-apply collaborators. Kept from the original facade
 * so existing log queries keep matching.
 */
export const DECISION_LIVE_LOG_CONTEXT = 'DecisionLiveApplyService';

export const IMPORT_ACTION_TYPE = DECISION_POLICY_ACTION_TYPES.IMPORT_ROW_MATCH;
export const DOCUMENT_SORT_ACTION_TYPE =
  DECISION_POLICY_ACTION_TYPES.DOCUMENT_SORT;

/** The heuristic's own answer. Jev is only asked about texts that get this answer. */
export const DOCUMENT_SORT_RULES_FINAL_TYPE: DocumentSortType = 'Sonstiges';
