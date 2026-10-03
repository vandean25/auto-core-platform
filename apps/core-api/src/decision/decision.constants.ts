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
