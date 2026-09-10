import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  toDecimalNumber,
  rethrowAsConflict,
} from './labor-shared.helpers';

// ── toDecimalNumber ───────────────────────────────────────────────────────────

describe('toDecimalNumber', () => {
  it('converts a plain JS number to itself', () => {
    expect(toDecimalNumber(95.5)).toBe(95.5);
  });

  it('preserves 0 (does not treat it as falsy/null)', () => {
    expect(toDecimalNumber(0)).toBe(0);
  });

  it('returns null when the input is null', () => {
    expect(toDecimalNumber(null)).toBeNull();
  });

  it('returns null when the input is undefined', () => {
    expect(toDecimalNumber(undefined)).toBeNull();
  });

  it('converts a Prisma Decimal object to a JS number', () => {
    const decimal = new Prisma.Decimal('123.45');
    expect(toDecimalNumber(decimal)).toBe(123.45);
  });

  it('converts a Prisma Decimal of 0 to the number 0 (not null)', () => {
    const decimal = new Prisma.Decimal('0');
    expect(toDecimalNumber(decimal)).toBe(0);
  });

  it('handles negative numbers correctly', () => {
    expect(toDecimalNumber(-42.5)).toBe(-42.5);
  });
});

// ── rethrowAsConflict ─────────────────────────────────────────────────────────

describe('rethrowAsConflict', () => {
  it('throws ConflictException for a Prisma P2002 error', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2002, 'Already exists')).toThrow(
      ConflictException,
    );
  });

  it('includes the caller-supplied message in the ConflictException', () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2002, 'Custom message here')).toThrow(
      'Custom message here',
    );
  });

  it('re-throws non-P2002 Prisma errors unchanged', () => {
    const p2025 = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      { code: 'P2025', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2025, 'irrelevant')).toThrow(p2025);
  });

  it('re-throws generic Error objects unchanged', () => {
    const err = new Error('Some other error');
    expect(() => rethrowAsConflict(err, 'irrelevant')).toThrow(err);
  });

  it('re-throws non-Error primitives unchanged', () => {
    expect(() => rethrowAsConflict('string error', 'irrelevant')).toThrow(
      'string error',
    );
  });

  it('does NOT throw ConflictException for P2002 with a different code prefix', () => {
    const p2000 = new Prisma.PrismaClientKnownRequestError(
      'Different code',
      { code: 'P2000', clientVersion: '0' },
    );
    expect(() => rethrowAsConflict(p2000, 'irrelevant')).toThrow(p2000);
    expect(() => rethrowAsConflict(p2000, 'irrelevant')).not.toThrow(
      ConflictException,
    );
  });
});
