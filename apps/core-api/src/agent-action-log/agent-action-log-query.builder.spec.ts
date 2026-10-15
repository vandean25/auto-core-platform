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

  it('filters agent_id with a case-insensitive substring match', () => {
    expect(
      buildAgentActionWhere('tenant-1', { agentId: 'qa-fresh' }),
    ).toEqual({
      tenant_id: 'tenant-1',
      agent_id: { contains: 'qa-fresh', mode: 'insensitive' },
    });
  });

  it('keeps tenant scoping when filtering by agent substring', () => {
    const where = buildAgentActionWhere('tenant-42', {
      agentId: 'mcp:QA-FRESH',
    });
    expect(where.tenant_id).toBe('tenant-42');
    expect(where.agent_id).toEqual({
      contains: 'mcp:QA-FRESH',
      mode: 'insensitive',
    });
  });

  it('rejects cursor when id is not a string', () => {
    const cursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-10-03T00:00:00.000Z',
        id: { bad: true },
      }),
      'utf8',
    ).toString('base64url');

    expect(() =>
      buildAgentActionWhere('tenant-1', {
        cursor,
      }),
    ).toThrow(BadRequestException);
  });
});
