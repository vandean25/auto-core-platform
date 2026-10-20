import type { CustomerProposalDiffEntry } from '../customer/customer-propose.payload.js';
import type { CustomerMatchCandidate } from '../customer/customer-match.util.js';

export type CustomerProposalResultFields = {
  diff?: CustomerProposalDiffEntry[];
  duplicate_candidates?: CustomerMatchCandidate[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The customer proposal preview carries the field diff and the duplicate
 * candidates. A write tool without a customer proposal has neither.
 */
export function readCustomerProposalFields(
  preview: unknown,
): CustomerProposalResultFields {
  if (!isRecord(preview)) {
    return {};
  }
  const diff = preview.diff;
  const duplicateCandidates = preview.duplicate_candidates;
  return {
    diff: Array.isArray(diff)
      ? (diff as CustomerProposalDiffEntry[])
      : undefined,
    duplicate_candidates: Array.isArray(duplicateCandidates)
      ? (duplicateCandidates as CustomerMatchCandidate[])
      : undefined,
  };
}
