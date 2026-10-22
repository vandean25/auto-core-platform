import { VehiclePartyRole } from '@prisma/client';

/** A party interval on `YYYY-MM-DD` days. Half-open `[valid_from, valid_to)`, a null bound is unbounded. */
export type PartyInterval = {
  id?: string;
  role: VehiclePartyRole;
  customer_id: string;
  valid_from: string | null;
  valid_to: string | null;
};

export type PartyRuleViolation = {
  code: string;
  message: string;
  field?: string;
};

export const VEHICLE_PARTY_RULE_CODES = {
  INTERVAL_INVALID: 'VEHICLE_PARTY_INTERVAL_INVALID',
  PREVIOUS_OWNER_END_REQUIRED: 'VEHICLE_PARTY_PREVIOUS_OWNER_END_REQUIRED',
  FUTURE_START_UNSUPPORTED: 'VEHICLE_PARTY_FUTURE_START_UNSUPPORTED',
  OVERLAP: 'VEHICLE_PARTY_OVERLAP',
} as const;

/** At most one of these is active per vehicle at any date. */
export const SINGLETON_PARTY_ROLES: readonly VehiclePartyRole[] = [
  VehiclePartyRole.OWNER,
  VehiclePartyRole.BILL_TO,
  VehiclePartyRole.LEASING,
];

export function isActiveOn(
  party: Pick<PartyInterval, 'valid_from' | 'valid_to'>,
  day: string,
): boolean {
  return (
    (party.valid_from === null || party.valid_from <= day) &&
    (party.valid_to === null || day < party.valid_to)
  );
}

function intervalsOverlap(a: PartyInterval, b: PartyInterval): boolean {
  const aStartsBeforeBEnds =
    a.valid_from === null || b.valid_to === null || a.valid_from < b.valid_to;
  const bStartsBeforeAEnds =
    b.valid_from === null || a.valid_to === null || b.valid_from < a.valid_to;
  return aStartsBeforeBEnds && bStartsBeforeAEnds;
}

function isOwnerRole(role: VehiclePartyRole): boolean {
  return (
    role === VehiclePartyRole.OWNER || role === VehiclePartyRole.PREVIOUS_OWNER
  );
}

/** Whether two parties compete for the same slot on a vehicle timeline. */
function competes(existing: PartyInterval, candidate: PartyInterval): boolean {
  if (SINGLETON_PARTY_ROLES.includes(candidate.role)) {
    if (existing.role === candidate.role) {
      return true;
    }
  }
  if (existing.customer_id !== candidate.customer_id) {
    return false;
  }
  return (
    existing.role === candidate.role ||
    (isOwnerRole(existing.role) && isOwnerRole(candidate.role))
  );
}

/** First existing party that blocks the candidate, including future intervals. */
export function findPartyConflict(
  existing: readonly PartyInterval[],
  candidate: PartyInterval,
): PartyInterval | undefined {
  return existing.find(
    (row) =>
      (candidate.id === undefined || row.id !== candidate.id) &&
      competes(row, candidate) &&
      intervalsOverlap(row, candidate),
  );
}

function checkInterval(party: PartyInterval): PartyRuleViolation | null {
  if (
    party.valid_from === null ||
    party.valid_to === null ||
    party.valid_from < party.valid_to
  ) {
    return null;
  }
  return {
    code: VEHICLE_PARTY_RULE_CODES.INTERVAL_INVALID,
    message: 'valid_from must be before valid_to',
    field: 'valid_to',
  };
}

function checkPreviousOwner(
  party: PartyInterval,
  cutoff: string,
): PartyRuleViolation | null {
  if (party.role !== VehiclePartyRole.PREVIOUS_OWNER) {
    return null;
  }
  if (party.valid_to !== null && party.valid_to <= cutoff) {
    return null;
  }
  return {
    code: VEHICLE_PARTY_RULE_CODES.PREVIOUS_OWNER_END_REQUIRED,
    message: `PREVIOUS_OWNER requires valid_to on or before ${cutoff}`,
    field: 'valid_to',
  };
}

function checkFutureStart(
  party: PartyInterval,
  today: string,
): PartyRuleViolation | null {
  const isFuture = party.valid_from !== null && party.valid_from > today;
  if (!isFuture || !SINGLETON_PARTY_ROLES.includes(party.role)) {
    return null;
  }
  return {
    code: VEHICLE_PARTY_RULE_CODES.FUTURE_START_UNSUPPORTED,
    message: `${party.role} with a future valid_from is not supported yet`,
    field: 'valid_from',
  };
}

/**
 * Checks one party on its own, without the rest of the timeline. `cutover` is the migration
 * cutover day; manual writes pass only `today`.
 */
export function validatePartyShape(
  party: PartyInterval,
  ctx: { today: string; cutover?: string },
): PartyRuleViolation | null {
  return (
    checkInterval(party) ??
    checkPreviousOwner(party, ctx.cutover ?? ctx.today) ??
    checkFutureStart(party, ctx.today)
  );
}

export function selectActiveOwner<T extends PartyInterval>(
  parties: readonly T[],
  day: string,
): T | null {
  return (
    parties.find(
      (row) => row.role === VehiclePartyRole.OWNER && isActiveOn(row, day),
    ) ?? null
  );
}

/** Read-only payer hint: active BILL_TO first, then LEASING. The owner is never a fallback. */
export function suggestBillTo(
  parties: readonly PartyInterval[],
  day: string,
): { customer_id: string; role: 'BILL_TO' | 'LEASING' } | null {
  for (const role of [VehiclePartyRole.BILL_TO, VehiclePartyRole.LEASING]) {
    const match = parties.find(
      (row) => row.role === role && isActiveOn(row, day),
    );
    if (match) {
      return { customer_id: match.customer_id, role };
    }
  }
  return null;
}
