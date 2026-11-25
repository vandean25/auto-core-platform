import { CustomerNoteRetentionClass } from '@prisma/client';
import {
  computeCustomerNoteRetainUntil,
  hashCustomerNoteBody,
  isNoteProtectedFromErasure,
} from './customer-note-retention.helpers.js';

describe('customer-note-retention.helpers', () => {
  describe('computeCustomerNoteRetainUntil', () => {
    it('adds 3 UTC years from lastCustomerActivityAt when OPERATIONAL and activity exists', () => {
      const now = new Date('2026-11-25T10:00:00.000Z');
      const result = computeCustomerNoteRetainUntil({
        retentionClass: CustomerNoteRetentionClass.OPERATIONAL,
        now,
        lastCustomerActivityAt: new Date('2026-06-01T08:00:00.000Z'),
      });
      expect(result.toISOString()).toBe('2029-06-01T08:00:00.000Z');
    });

    it('falls back to 3 UTC years from now when OPERATIONAL and no customer activity exists', () => {
      const now = new Date('2026-11-25T10:00:00.000Z');
      const result = computeCustomerNoteRetainUntil({
        retentionClass: CustomerNoteRetentionClass.OPERATIONAL,
        now,
        lastCustomerActivityAt: null,
      });
      expect(result.toISOString()).toBe('2029-11-25T10:00:00.000Z');
    });

    it('computes 3 years from end of year of order close for CLAIMS_3Y', () => {
      const now = new Date('2026-11-25T10:00:00.000Z');
      const result = computeCustomerNoteRetainUntil({
        retentionClass: CustomerNoteRetentionClass.CLAIMS_3Y,
        now,
        orderClosedAt: new Date('2026-03-10T14:30:00.000Z'),
      });
      expect(result.toISOString()).toBe('2029-12-31T23:59:59.999Z');
    });
  });

  describe('hashCustomerNoteBody', () => {
    it('returns a deterministic 64-char sha256 hex digest without plaintext', () => {
      const digest = hashCustomerNoteBody('Sensitive customer note');
      expect(digest).toMatch(/^[0-9a-f]{64}$/);
      expect(digest).toBe(hashCustomerNoteBody('Sensitive customer note'));
      expect(digest).not.toContain('Sensitive');
    });
  });

  describe('isNoteProtectedFromErasure', () => {
    it('returns false for OPERATIONAL note without legal_hold', () => {
      expect(
        isNoteProtectedFromErasure({
          legal_hold: false,
          retention_class: CustomerNoteRetentionClass.OPERATIONAL,
        }),
      ).toBe(false);
    });

    it('returns true when legal_hold is true', () => {
      expect(
        isNoteProtectedFromErasure({
          legal_hold: true,
          retention_class: CustomerNoteRetentionClass.OPERATIONAL,
        }),
      ).toBe(true);
    });

    it('returns true when retention_class is CLAIMS_3Y', () => {
      expect(
        isNoteProtectedFromErasure({
          legal_hold: false,
          retention_class: CustomerNoteRetentionClass.CLAIMS_3Y,
        }),
      ).toBe(true);
    });
  });
});
