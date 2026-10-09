import { BadRequestException } from '@nestjs/common';
import {
  buildDecisionShadowLogWhere,
  decodeDecisionShadowLogCursor,
  encodeDecisionShadowLogCursor,
} from './decision-shadow-log-query.builder.js';

describe('decision-shadow-log-query.builder', () => {
  it('always scopes by tenant and filters by use case', () => {
    expect(
      buildDecisionShadowLogWhere('tenant-1', { useCase: 'document_sort' }),
    ).toEqual({ tenant_id: 'tenant-1', use_case: 'document_sort' });
  });

  it('applies created_at bounds, treating date-only endDate as inclusive UTC day', () => {
    const where = buildDecisionShadowLogWhere('tenant-1', {
      startDate: '2026-10-01T00:00:00.000Z',
      endDate: '2026-10-03',
    });

    expect(where.created_at).toEqual({
      gte: new Date('2026-10-01T00:00:00.000Z'),
      lte: new Date('2026-10-03T23:59:59.999Z'),
    });
  });

  it('rejects a startDate after endDate', () => {
    expect(() =>
      buildDecisionShadowLogWhere('tenant-1', {
        startDate: '2026-10-05',
        endDate: '2026-10-01',
      }),
    ).toThrow(BadRequestException);
  });

  it('turns a cursor into a stable (created_at, id) keyset condition', () => {
    const cursor = encodeDecisionShadowLogCursor({
      createdAt: '2026-10-03T12:00:00.000Z',
      id: 'row-2',
    });

    expect(buildDecisionShadowLogWhere('tenant-1', { cursor }).OR).toEqual([
      { created_at: { lt: new Date('2026-10-03T12:00:00.000Z') } },
      {
        created_at: new Date('2026-10-03T12:00:00.000Z'),
        id: { lt: 'row-2' },
      },
    ]);
  });

  it('round-trips cursors and rejects malformed ones', () => {
    const cursor = { createdAt: '2026-10-03T12:00:00.000Z', id: 'row-2' };
    expect(
      decodeDecisionShadowLogCursor(encodeDecisionShadowLogCursor(cursor)),
    ).toEqual(cursor);

    expect(decodeDecisionShadowLogCursor('not-a-cursor')).toBeUndefined();

    const invalidDate = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', id: 'row-2' }),
      'utf8',
    ).toString('base64url');
    expect(() =>
      buildDecisionShadowLogWhere('tenant-1', { cursor: invalidDate }),
    ).toThrow(BadRequestException);

    const nonStringId = Buffer.from(
      JSON.stringify({ createdAt: '2026-10-03T00:00:00.000Z', id: { x: 1 } }),
      'utf8',
    ).toString('base64url');
    expect(() =>
      buildDecisionShadowLogWhere('tenant-1', { cursor: nonStringId }),
    ).toThrow(BadRequestException);
  });
});
