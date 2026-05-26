import {
  buildAuditChangeSet,
  computeAuditDiff,
  normalizeAuditValue,
} from './audit-diff.util';
import { REDACTED_VALUE } from './audit-redaction.util';

class Decimal {
  constructor(private readonly value: string) {}

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

describe('audit diff utilities', () => {
  it('normalizes dates, decimal-like values, and omits undefined fields', () => {
    const normalized = normalizeAuditValue({
      createdAt: new Date('2026-05-26T10:00:00.000Z'),
      total: new Decimal('19.99'),
      nested: {
        optional: undefined,
        amount: new Decimal('5.50'),
      },
      items: [new Decimal('1.25'), undefined, new Date('2026-01-01T00:00:00.000Z')],
    });

    expect(normalized).toEqual({
      createdAt: '2026-05-26T10:00:00.000Z',
      total: '19.99',
      nested: {
        amount: '5.50',
      },
      items: ['1.25', null, '2026-01-01T00:00:00.000Z'],
    });
  });

  it('returns empty changed fields and diff when records are unchanged', () => {
    const before = { status: 'DRAFT', quantity: 1 };
    const after = { status: 'DRAFT', quantity: 1 };

    const result = computeAuditDiff(before, after);

    expect(result.changedFields).toEqual([]);
    expect(result.diff).toEqual({});
  });

  it('computes single-field and multi-field top-level changes including null transitions', () => {
    const result = computeAuditDiff(
      {
        status: 'DRAFT',
        notes: 'old',
        assigned_to: null,
      },
      {
        status: 'CONFIRMED',
        notes: null,
        assigned_to: 'user-1',
      },
    );

    expect(result.changedFields).toEqual(['assigned_to', 'notes', 'status']);
    expect(result.diff).toEqual({
      assigned_to: { before: null, after: 'user-1' },
      notes: { before: 'old', after: null },
      status: { before: 'DRAFT', after: 'CONFIRMED' },
    });
  });

  it('redacts snapshots before computing persisted diff output', () => {
    const result = buildAuditChangeSet(
      {
        user: 'jane@example.com',
        password: 'before-secret',
        profile: {
          refreshToken: 'before-refresh',
        },
      },
      {
        user: 'jane@example.com',
        password: 'after-secret',
        profile: {
          refreshToken: 'after-refresh',
        },
        access_token: 'new-access',
      },
    );

    expect(result.before).toEqual({
      user: 'jane@example.com',
      password: REDACTED_VALUE,
      profile: {
        refreshToken: REDACTED_VALUE,
      },
    });
    expect(result.after).toEqual({
      user: 'jane@example.com',
      password: REDACTED_VALUE,
      profile: {
        refreshToken: REDACTED_VALUE,
      },
      access_token: REDACTED_VALUE,
    });
    expect(result.redactedFields).toEqual([
      'access_token',
      'password',
      'profile.refreshToken',
    ]);
    expect(result.diff).toEqual({
      access_token: { before: undefined, after: REDACTED_VALUE },
    });
    expect(result.changedFields).toEqual(['access_token']);
  });
});
