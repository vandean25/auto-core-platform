import {
  DOCUMENT_SORT_TYPES,
  type DocumentSortType,
} from './decision.constants.js';

const RULES: Array<{ type: DocumentSortType; patterns: RegExp[] }> = [
  {
    type: 'Rechnung',
    patterns: [/\brechnung\b/i, /\brechnungsnummer\b/i, /\bust-?id\b/i],
  },
  {
    type: 'Lieferschein',
    patterns: [/\blieferschein\b/i, /\blieferung\b/i, /\bversand\b/i],
  },
  {
    type: 'Kostenvoranschlag',
    patterns: [/\bkostenvoranschlag\b/i, /\bangebot\b/i, /\bkva\b/i],
  },
  {
    type: 'Fahrzeugschein',
    patterns: [
      /\bfahrzeugschein\b/i,
      /\bzulassungsbescheinigung\b/i,
      /\bteil\s*i\b/i,
      /\bfin\b/i,
    ],
  },
];

export function classifyDocumentTextHeuristic(text: string): DocumentSortType {
  const normalized = text.trim();
  if (!normalized) {
    return 'Sonstiges';
  }
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.type;
    }
  }
  return 'Sonstiges';
}

export function documentSortChoices(): DocumentSortType[] {
  return [...DOCUMENT_SORT_TYPES];
}
