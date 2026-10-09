export const DECISION_PROVIDER_TOKEN = Symbol('DECISION_PROVIDER');

export type DecisionProviderId = 'noop' | 'openrouter-jev';

export const DECISION_USE_CASES = {
  IMPORT_ROW_MATCHING: 'import_row_matching',
  DOCUMENT_SORT: 'document_sort',
} as const;

export type DecisionUseCase =
  (typeof DECISION_USE_CASES)[keyof typeof DECISION_USE_CASES];

export const DOCUMENT_SORT_TYPES = [
  'Rechnung',
  'Lieferschein',
  'Kostenvoranschlag',
  'Fahrzeugschein',
  'Sonstiges',
] as const;

export type DocumentSortType = (typeof DOCUMENT_SORT_TYPES)[number];

export const OPENROUTER_JEV_DEFAULT_MODEL = 'typesafe/jev-1.13';

export const DEFAULT_DECISION_HTTP_TIMEOUT_MS = 5_000;

/** Rough char-per-token estimate for input size guard (~24K tokens). */
export const DECISION_MAX_INPUT_TOKEN_ESTIMATE = 24_000;
export const DECISION_CHARS_PER_TOKEN_ESTIMATE = 4;

/** AUT-413: `shadow` (default, log only) or `live` (awaited suggestions, gated by policy tier). */
export const DECISION_APPLY_MODES = ['shadow', 'live'] as const;
export type DecisionApplyMode = (typeof DECISION_APPLY_MODES)[number];

/** Tenant-level override value. Only opting out is supported; a tenant cannot turn live on. */
export const DECISION_TENANT_OPT_OUT_MODE = 'shadow';

/** Policy action types for live suggestions. Platform default rows are seeded by migration. */
export const DECISION_POLICY_ACTION_TYPES = {
  IMPORT_ROW_MATCH: 'decision.import_row_match',
  DOCUMENT_SORT: 'decision.document_sort',
} as const;

/** Maximum Jev calls in flight for one live import dry-run. */
export const DECISION_LIVE_MAX_CONCURRENT_CALLS = 8;

/** Whole-batch budget for live import decisions, as a multiple of DECISION_HTTP_TIMEOUT_MS. */
export const DECISION_LIVE_BATCH_BUDGET_MULTIPLIER = 2;
