import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, WarrantyClaimStatus } from '@prisma/client';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

/** Owners, admins and the workshop advisor (tenant role SALES) work with claims. TECH never does. */
export const WARRANTY_CLAIM_ROLES: ReadonlySet<string> = new Set([
  'OWNER',
  'ADMIN',
  'SALES',
]);

export const WARRANTY_CLAIM_MAX_TEXT_LENGTH = 4000;
export const WARRANTY_CLAIM_MAX_AMOUNT_EUR = 1_000_000;
export const WARRANTY_CLAIM_MAX_LINES = 200;

export const WARRANTY_CLAIM_ERROR_CODES = {
  ORDER_NOT_CHECKED_IN: 'WARRANTY_CLAIM_ORDER_NOT_CHECKED_IN',
  CLOSED: 'WARRANTY_CLAIM_CLOSED',
  LOCKED: 'WARRANTY_CLAIM_LOCKED',
  INVALID_TRANSITION: 'WARRANTY_CLAIM_INVALID_TRANSITION',
  SUBMISSION_INCOMPLETE: 'WARRANTY_CLAIM_SUBMISSION_INCOMPLETE',
  DECISION_DATE_REQUIRED: 'WARRANTY_CLAIM_DECISION_DATE_REQUIRED',
  LINE_NOT_ON_ORDER: 'WARRANTY_CLAIM_LINE_NOT_ON_ORDER',
  LINE_CANCELLED: 'WARRANTY_CLAIM_LINE_CANCELLED',
  LINE_ALREADY_CLAIMED: 'WARRANTY_CLAIM_LINE_ALREADY_CLAIMED',
  STATE_CHANGED: 'WARRANTY_CLAIM_STATE_CHANGED',
} as const;

/** Claim lifecycle. CLOSED is terminal. A rejected claim is closed and re-filed as a new claim. */
const ALLOWED_TRANSITIONS: Readonly<
  Record<WarrantyClaimStatus, readonly WarrantyClaimStatus[]>
> = {
  DRAFT: ['SUBMITTED_EXTERNALLY', 'CLOSED'],
  SUBMITTED_EXTERNALLY: ['APPROVED', 'REJECTED', 'CLOSED'],
  APPROVED: ['CLOSED'],
  REJECTED: ['CLOSED'],
  CLOSED: [],
};

export function assertWarrantyClaimAccess(
  tenantContext: TenantContextService,
): void {
  const role = tenantContext.getAuthenticatedUser()?.role;
  if (!role || !WARRANTY_CLAIM_ROLES.has(role)) {
    throw new ForbiddenException(
      'Garantie/Kulanz claims are restricted to owners, admins and workshop advisors.',
    );
  }
}

export function assertWarrantyClaimTransition(
  from: WarrantyClaimStatus,
  to: WarrantyClaimStatus,
): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new ConflictException({
      code: WARRANTY_CLAIM_ERROR_CODES.INVALID_TRANSITION,
      message: `A warranty claim cannot change from ${from} to ${to}.`,
    });
  }
}

/** Type, complaint, cause/correction, lines and claimed amount are frozen once the claim leaves DRAFT. */
export function isWarrantyClaimContentEditable(
  status: WarrantyClaimStatus,
): boolean {
  return status === WarrantyClaimStatus.DRAFT;
}

export function missingSubmissionFields(claim: {
  complaint: string | null;
  claimedAmountNet: Prisma.Decimal | null;
  lineCount: number;
}): string[] {
  const missing: string[] = [];
  if (!claim.complaint?.trim()) missing.push('complaint');
  if (!claim.claimedAmountNet || claim.claimedAmountNet.lte(0)) {
    missing.push('claimedAmountNet');
  }
  if (claim.lineCount === 0) missing.push('lines');
  return missing;
}

/** What each missing submission field asks for, worded for the 422 message. */
const SUBMISSION_GAP_PHRASES: Record<string, string> = {
  complaint: 'a complaint',
  claimedAmountNet: 'a claimed amount above zero',
  lines: 'at least one affected line',
};

/** Names only the gaps that are left, so the advisor knows what to fix. */
function submissionGapMessage(missing: string[]): string {
  const phrases = missing.map((field) => SUBMISSION_GAP_PHRASES[field]);
  const last = phrases[phrases.length - 1];
  const list =
    phrases.length > 1
      ? `${phrases.slice(0, -1).join(', ')} and ${last}`
      : last;
  return `A claim needs ${list} before it can be submitted.`;
}

export function assertWarrantyClaimSubmittable(
  claim: Parameters<typeof missingSubmissionFields>[0],
): void {
  const missing = missingSubmissionFields(claim);
  if (missing.length > 0) {
    throw new UnprocessableEntityException({
      code: WARRANTY_CLAIM_ERROR_CODES.SUBMISSION_INCOMPLETE,
      message: submissionGapMessage(missing),
      missingFields: missing,
    });
  }
}

export function assertWarrantyClaimDecisionDate(
  to: WarrantyClaimStatus,
  decisionDate: Date | null,
): void {
  const isDecision =
    to === WarrantyClaimStatus.APPROVED || to === WarrantyClaimStatus.REJECTED;
  if (isDecision && !decisionDate) {
    throw new UnprocessableEntityException({
      code: WARRANTY_CLAIM_ERROR_CODES.DECISION_DATE_REQUIRED,
      message: 'Approving or rejecting a claim requires a decision date.',
    });
  }
}

/** Net amount of an order line: quantity times unit price, rounded to cents (half up). */
export function computeLineNetAmount(
  quantity: Prisma.Decimal,
  unitPrice: Prisma.Decimal,
): Prisma.Decimal {
  return quantity.mul(unitPrice).toDecimalPlaces(2);
}

/** Parses a `YYYY-MM-DD` calendar day into a UTC date. Rejects impossible days such as 2026-02-30. */
export function parseWarrantyClaimDay(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new UnprocessableEntityException(`Invalid calendar day: ${value}`);
  }
  return parsed;
}

/** Trims free text and turns blank input into null. */
export function normalizeWarrantyClaimText(
  value: string | null,
): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
}

/** Top-level fields whose value differs between two claim snapshots, as `{ field: { from, to } }`. */
export function diffWarrantyClaimSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === 'updatedAt') continue;
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      diff[key] = { from: before[key], to: after[key] };
    }
  }
  return diff;
}
