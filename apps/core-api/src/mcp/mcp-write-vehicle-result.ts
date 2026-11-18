import type { VehicleProposalDiffEntry } from '../vehicle/vehicle-propose.payload.js';
import type { VehicleDuplicateCandidate } from '../vehicle/vehicle-duplicate-check.js';

export type VehicleProposalResultFields = {
  diff?: VehicleProposalDiffEntry[];
  duplicate_candidates?: VehicleDuplicateCandidate[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The vehicle proposal preview carries the field diff and the duplicate
 * candidates. A write tool without a vehicle proposal has neither.
 */
export function readVehicleProposalFields(
  preview: unknown,
): VehicleProposalResultFields {
  if (!isRecord(preview)) {
    return {};
  }
  const diff = preview.diff;
  const duplicateCandidates = preview.duplicate_candidates;
  return {
    diff: Array.isArray(diff)
      ? (diff as VehicleProposalDiffEntry[])
      : undefined,
    duplicate_candidates: Array.isArray(duplicateCandidates)
      ? (duplicateCandidates as VehicleDuplicateCandidate[])
      : undefined,
  };
}
