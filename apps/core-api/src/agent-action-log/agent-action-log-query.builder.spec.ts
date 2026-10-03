import { BadRequestException } from '@nestjs/common';
import {
  buildAgentActionWhere,
  parseInclusiveEndDate,
} from './agent-action-log-query.builder.js';

describe('agent-action-log-query.builder', () => {
  it('treats date-only endDate as inclusive through end of UTC day', () => {
    const end = parseInclusiveEndDate('2026-10-03');
    expect(end.toISOString()).toBe('2026-10-03T23:59:59.999Z');
  });

  it('rejects invalid cursor values', () => {
    expect(() =>
      buildAgentActionWhere('tenant-1', {
        cursor: 'not-valid-base64',
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects cursor with invalid createdAt', () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: 'not-a-date', id: 'log-1' }),
      'utf8',
    ).toString('base64url');

    expect(() =>
      buildAgentActionWhere('tenant-1', {
        cursor,
      }),
    ).toThrow(BadRequestException);
  });
});
