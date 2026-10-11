import { ConflictException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, WarrantyClaimStatus } from '@prisma/client';
import {
  WARRANTY_CLAIM_ERROR_CODES,
  assertWarrantyClaimAccess,
  assertWarrantyClaimDecisionDate,
  assertWarrantyClaimSubmittable,
  assertWarrantyClaimTransition,
  computeLineNetAmount,
  diffWarrantyClaimSnapshots,
  isWarrantyClaimContentEditable,
  missingSubmissionFields,
  normalizeWarrantyClaimText,
  parseWarrantyClaimDay,
} from './warranty-claim.rules.js';
import type { TenantContextService } from '../common/services/tenant-context.service.js';

const { DRAFT, SUBMITTED_EXTERNALLY, APPROVED, REJECTED, CLOSED } = WarrantyClaimStatus;

function contextWithRole(role: string | undefined): TenantContextService {
  return {
    getAuthenticatedUser: () => (role === undefined ? undefined : { role }),
  } as unknown as TenantContextService;
}

describe('warranty claim rules', () => {
  describe('access', () => {
    it.each(['OWNER', 'ADMIN', 'SALES'])('allows the %s role', (role) => {
      expect(() => assertWarrantyClaimAccess(contextWithRole(role))).not.toThrow();
    });

    it.each(['TECH', 'worker'])('rejects the %s role', (role) => {
      expect(() => assertWarrantyClaimAccess(contextWithRole(role))).toThrow(ForbiddenException);
    });

    it('rejects a request without an authenticated role', () => {
      expect(() => assertWarrantyClaimAccess(contextWithRole(undefined))).toThrow(ForbiddenException);
    });
  });

  describe('status transitions', () => {
    it.each([
      [DRAFT, SUBMITTED_EXTERNALLY],
      [DRAFT, CLOSED],
      [SUBMITTED_EXTERNALLY, APPROVED],
      [SUBMITTED_EXTERNALLY, REJECTED],
      [SUBMITTED_EXTERNALLY, CLOSED],
      [APPROVED, CLOSED],
      [REJECTED, CLOSED],
    ])('allows %s -> %s', (from, to) => {
      expect(() => assertWarrantyClaimTransition(from, to)).not.toThrow();
    });

    it.each([
      [DRAFT, APPROVED],
      [DRAFT, REJECTED],
      [SUBMITTED_EXTERNALLY, DRAFT],
      [APPROVED, SUBMITTED_EXTERNALLY],
      [REJECTED, SUBMITTED_EXTERNALLY],
      [CLOSED, DRAFT],
      [CLOSED, APPROVED],
    ])('rejects %s -> %s with a conflict', (from, to) => {
      expect(() => assertWarrantyClaimTransition(from, to)).toThrow(ConflictException);
    });

    it('makes content editable only in DRAFT', () => {
      expect(isWarrantyClaimContentEditable(DRAFT)).toBe(true);
      for (const status of [SUBMITTED_EXTERNALLY, APPROVED, REJECTED, CLOSED]) {
        expect(isWarrantyClaimContentEditable(status)).toBe(false);
      }
    });
  });

  describe('submission', () => {
    const complete = {
      complaint: 'Kupplung rutscht',
      claimedAmountNet: new Prisma.Decimal('420.00'),
      lineCount: 2,
    };

    it('reports every missing field', () => {
      expect(
        missingSubmissionFields({ complaint: '   ', claimedAmountNet: null, lineCount: 0 }),
      ).toEqual(['complaint', 'claimedAmountNet', 'lines']);
    });

    it('treats a zero claimed amount as missing', () => {
      expect(
        missingSubmissionFields({ ...complete, claimedAmountNet: new Prisma.Decimal(0) }),
      ).toEqual(['claimedAmountNet']);
    });

    it('accepts a complete claim', () => {
      expect(missingSubmissionFields(complete)).toEqual([]);
      expect(() => assertWarrantyClaimSubmittable(complete)).not.toThrow();
    });

    it('throws a 422 with the missing fields listed', () => {
      try {
        assertWarrantyClaimSubmittable({ ...complete, lineCount: 0 });
        throw new Error('expected a throw');
      } catch (error) {
        expect(error).toBeInstanceOf(UnprocessableEntityException);
        expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
          code: WARRANTY_CLAIM_ERROR_CODES.SUBMISSION_INCOMPLETE,
          missingFields: ['lines'],
        });
      }
    });

    it('requires a decision date for approval and rejection only', () => {
      expect(() => assertWarrantyClaimDecisionDate(APPROVED, null)).toThrow(UnprocessableEntityException);
      expect(() => assertWarrantyClaimDecisionDate(REJECTED, null)).toThrow(UnprocessableEntityException);
      expect(() => assertWarrantyClaimDecisionDate(SUBMITTED_EXTERNALLY, null)).not.toThrow();
      expect(() => assertWarrantyClaimDecisionDate(APPROVED, new Date('2026-10-10T00:00:00Z'))).not.toThrow();
    });
  });

  describe('amounts and input', () => {
    it('rounds the line net amount half up to cents', () => {
      expect(computeLineNetAmount(new Prisma.Decimal('1.5'), new Prisma.Decimal('9.99')).toFixed(2)).toBe('14.99');
      expect(computeLineNetAmount(new Prisma.Decimal('1.333'), new Prisma.Decimal('10.00')).toFixed(2)).toBe('13.33');
      expect(computeLineNetAmount(new Prisma.Decimal('3.000'), new Prisma.Decimal('0.10')).toFixed(2)).toBe('0.30');
    });

    it('parses a real calendar day and rejects impossible ones', () => {
      expect(parseWarrantyClaimDay('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z');
      expect(() => parseWarrantyClaimDay('2026-02-30')).toThrow(UnprocessableEntityException);
      expect(() => parseWarrantyClaimDay('2026-13-01')).toThrow(UnprocessableEntityException);
    });

    it('turns blank free text into null and trims the rest', () => {
      expect(normalizeWarrantyClaimText('   ')).toBeNull();
      expect(normalizeWarrantyClaimText(null)).toBeNull();
      expect(normalizeWarrantyClaimText('  Lenkung knackt  ')).toBe('Lenkung knackt');
    });
  });

  describe('snapshot diff', () => {
    it('reports only the fields that changed and ignores updatedAt', () => {
      const before = { status: DRAFT, complaint: 'a', updatedAt: '2026-10-10T08:00:00.000Z' };
      const after = { status: SUBMITTED_EXTERNALLY, complaint: 'a', updatedAt: '2026-10-10T09:00:00.000Z' };
      expect(diffWarrantyClaimSnapshots(before, after)).toEqual({
        status: { from: DRAFT, to: SUBMITTED_EXTERNALLY },
      });
    });

    it('reports nothing for identical snapshots', () => {
      const snapshot = { lines: [{ id: 'l1', netAmount: '10.00' }] };
      expect(diffWarrantyClaimSnapshots(snapshot, { lines: [{ id: 'l1', netAmount: '10.00' }] })).toEqual({});
    });
  });
});
