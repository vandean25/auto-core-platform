import type { AgentActionLog, AuditLog } from '@prisma/client';
import {
  MCP_ACTION_PREVIEW_MAX_BYTES,
  MCP_HISTORY_MAX_CHANGES,
  MCP_HISTORY_MAX_VALUE_BYTES,
  buildMcpAuditChanges,
  buildMcpKeysetPage,
  keysetCursorOf,
  toMcpAgentActionDetailRow,
  toMcpAgentActionRow,
  toMcpAuditEventRow,
  toMcpAuditHistoryEntry,
} from './mcp-audit-read.mapper.js';
import { decodeMcpKeysetCursor } from './mcp-output.util.js';
import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';

const TRACE_ID = '6f1c2b7e-3d4a-4b8e-9c2d-1a2b3c4d5e6f';
const ROW_ID = '00000000-0000-4000-8000-0000000000a1';
const USER_ID = '00000000-0000-4000-8000-0000000000b1';
const ENTITY_ID = '00000000-0000-4000-8000-0000000000c1';

function auditRecord(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: ROW_ID,
    tenant_id: 'tenant-a',
    entity_type: 'Customer',
    entity_id: ENTITY_ID,
    action: 'UPDATE',
    actor_user_id: USER_ID,
    actor_email: 'owner@example.com',
    actor_role: 'OWNER',
    actor_type: 'USER',
    request_id: TRACE_ID,
    source: 'API',
    ip_address: '203.0.113.7',
    user_agent: 'Mozilla/5.0 (fixture)',
    before: null,
    after: null,
    diff: null,
    changed_fields: null,
    redacted_fields: null,
    occurred_at: new Date('2026-10-10T08:00:00.000Z'),
    ...overrides,
  };
}

function agentActionRecord(overrides: Partial<AgentActionLog> = {}): AgentActionLog {
  return {
    id: ROW_ID,
    tenant_id: 'tenant-a',
    trace_id: TRACE_ID,
    parent_trace_id: null,
    actor_type: 'AGENT',
    agent_id: 'mcp:cursor',
    on_behalf_of_user_id: USER_ID,
    action_type: 'mcp.search_customers',
    tier: 'AUTO',
    status: 'EXECUTED',
    input_summary_json: { tool: 'search_customers', args: { search: 'Musterwerkstatt' } },
    result_summary_json: null,
    entity_type: null,
    entity_id: null,
    reversible: false,
    reverted_by_log_id: null,
    created_at: new Date('2026-10-10T08:05:00.000Z'),
    ...overrides,
  };
}

describe('toMcpAuditEventRow', () => {
  it('returns compact fields with the actor user ID and no contact or network data', () => {
    const row = toMcpAuditEventRow(auditRecord());

    expect(row).toEqual({
      id: ROW_ID,
      at: '2026-10-10T08:00:00.000Z',
      entity_type: 'Customer',
      entity_id: ENTITY_ID,
      action: 'UPDATE',
      actor: USER_ID,
      trace_id: TRACE_ID,
    });
    expect(JSON.stringify(row)).not.toMatch(
      /owner@example\.com|203\.0\.113\.7|Mozilla/,
    );
  });

  it('omits trace_id when the request ID is not a trace UUID', () => {
    expect(
      toMcpAuditEventRow(auditRecord({ request_id: 'req-123' })),
    ).not.toHaveProperty('trace_id');
    expect(
      toMcpAuditEventRow(auditRecord({ request_id: null })),
    ).not.toHaveProperty('trace_id');
  });
});

describe('buildMcpAuditChanges', () => {
  it('masks email, phone, and address values in before and after, and scrubs emails inside text', () => {
    const record = auditRecord({
      before: {
        email: 'john.doe@example.com',
        phone: '+43 660 1234567',
        address: 'Musterstraße 12, 1010 Wien',
        name: 'Erika Musterfrau',
        notes: 'Call john.doe@example.com',
      },
      after: {
        email: 'erika@example.org',
        phone: '+43 660 7654321',
        address: 'Hauptplatz 1, 4020 Linz',
        name: 'Erika Beispiel',
        notes: 'Call erika@example.org',
      },
    });

    const { changes, changes_total } = buildMcpAuditChanges(record);

    expect(changes_total).toBe(5);
    expect(changes).toEqual([
      { field: 'address', from: '***', to: '***', masked: true },
      {
        field: 'email',
        from: 'j***@example.com',
        to: 'e***@example.org',
        masked: true,
      },
      // Personal names are not masked; only contact and address fields are.
      { field: 'name', from: 'Erika Musterfrau', to: 'Erika Beispiel' },
      {
        field: 'notes',
        from: 'Call j***@example.com',
        to: 'Call e***@example.org',
        masked: true,
      },
      {
        field: 'phone',
        from: '+** *** *****67',
        to: '+** *** *****21',
        masked: true,
      },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(
      /john\.doe|erika@|1234567|7654321|Musterstra/,
    );
  });

  it('uses the stored field diff when the row holds one', () => {
    const { changes } = buildMcpAuditChanges(
      auditRecord({
        before: null,
        after: null,
        diff: { status: { before: 'DRAFT', after: 'CONFIRMED' } },
      }),
    );

    expect(changes).toEqual([
      { field: 'status', from: 'DRAFT', to: 'CONFIRMED' },
    ]);
  });

  it('masks a contact value on a create row where before is null', () => {
    const { changes } = buildMcpAuditChanges(
      auditRecord({
        action: 'CREATE',
        before: null,
        after: { email: 'anna@example.com' },
      }),
    );

    expect(changes).toEqual([
      { field: 'email', from: null, to: 'a***@example.com', masked: true },
    ]);
  });

  it('redacts secret fields and never returns their values', () => {
    const { changes } = buildMcpAuditChanges(
      auditRecord({
        before: null,
        after: null,
        diff: { password: { before: 'old-secret', after: 'new-secret' } },
      }),
    );

    expect(changes).toEqual([
      { field: 'password', from: '[REDACTED]', to: '[REDACTED]' },
    ]);
    expect(JSON.stringify(changes)).not.toMatch(/secret/);
  });

  it('caps each value and reports the full change count', () => {
    const { changes, changes_total } = buildMcpAuditChanges(
      auditRecord({
        before: null,
        after: { notes: 'x'.repeat(4000) },
      }),
    );

    expect(changes_total).toBe(1);
    const to = changes[0].to as Record<string, unknown>;
    expect(to.__truncated__).toBe(true);
    expect(to.originalBytes).toBeGreaterThan(
      MCP_HISTORY_MAX_VALUE_BYTES,
    );
  });

  it('keeps at most MCP_HISTORY_MAX_CHANGES fields and flags the rest', () => {
    const after = Object.fromEntries(
      Array.from({ length: 25 }, (_, index) => [
        `field_${String(index).padStart(2, '0')}`,
        `value ${index}`,
      ]),
    );

    const entry = toMcpAuditHistoryEntry(
      auditRecord({ action: 'CREATE', before: null, after }),
    );

    expect(entry.changes).toHaveLength(MCP_HISTORY_MAX_CHANGES);
    expect(entry.changes_total).toBe(25);
    expect(entry.changes_truncated).toBe(true);
    expect(entry.changes[0].field).toBe('field_00');
  });

  it('does not treat numeric identifiers, dates, or amounts as phone numbers', () => {
    const { changes_total, changes } = buildMcpAuditChanges(
      auditRecord({
        before: null,
        after: {
          due_date: '2026-10-12',
          amount: '1250.00',
          invoice_no: '20260001234',
          address_id: ENTITY_ID,
        },
      }),
    );

    expect(changes_total).toBe(4);
    expect(changes.every((change) => change.masked === undefined)).toBe(true);
    expect(changes.find((change) => change.field === 'address_id')).toEqual({
      field: 'address_id',
      from: null,
      to: ENTITY_ID,
    });
  });
});

describe('toMcpAuditHistoryEntry', () => {
  it('returns the readable history shape without contact details', () => {
    const entry = toMcpAuditHistoryEntry(
      auditRecord({
        before: { email: 'john.doe@example.com' },
        after: { email: 'erika@example.org' },
      }),
    );

    expect(entry).toEqual({
      id: ROW_ID,
      at: '2026-10-10T08:00:00.000Z',
      actor: USER_ID,
      action: 'UPDATE',
      trace_id: TRACE_ID,
      changes: [
        {
          field: 'email',
          from: 'j***@example.com',
          to: 'e***@example.org',
          masked: true,
        },
      ],
      changes_total: 1,
    });
  });
});

describe('agent action rows', () => {
  it('reads the tool name from the logged input summary', () => {
    expect(toMcpAgentActionRow(agentActionRecord())).toEqual({
      id: ROW_ID,
      trace_id: TRACE_ID,
      at: '2026-10-10T08:05:00.000Z',
      agent: 'mcp:cursor',
      tool: 'search_customers',
      action_type: 'mcp.search_customers',
      tier: 'AUTO',
      status: 'EXECUTED',
      entity_type: null,
      entity_id: null,
    });
  });

  it('returns null for a tool when the input summary has none', () => {
    expect(
      toMcpAgentActionRow(agentActionRecord({ input_summary_json: null })).tool,
    ).toBeNull();
  });

  it('masks contact values and caps input and result previews in the detail row', () => {
    const detail = toMcpAgentActionDetailRow(
      agentActionRecord({
        input_summary_json: {
          tool: 'propose_line_item',
          args: { contact: { email: 'john.doe@example.com' } },
        },
        result_summary_json: { note: 'y'.repeat(3000) },
      }),
    );

    expect(detail.input).toEqual({
      tool: 'propose_line_item',
      args: { contact: { email: 'j***@example.com' } },
    });
    expect(detail.result).toMatchObject({ __truncated__: true });
    expect(JSON.stringify(detail)).not.toContain('john.doe');
    expect(
      Buffer.byteLength(JSON.stringify(detail.result), 'utf8'),
    ).toBeLessThanOrEqual(MCP_ACTION_PREVIEW_MAX_BYTES);
  });
});

describe('buildMcpKeysetPage', () => {
  type Item = { id: string; at: Date; blob: string };

  const item = (index: number, blob = ''): Item => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    at: new Date(Date.UTC(2026, 9, 10, 8, 0, index)),
    blob,
  });

  it('keeps pageSize rows and points next_cursor at the last one when more exist', () => {
    const records = [item(3), item(2), item(1)];

    const page = buildMcpKeysetPage({
      records,
      pageSize: 2,
      cursorOf: (record) => keysetCursorOf(record.at, record.id),
      mapRow: (record) => ({ id: record.id }),
    });

    expect(page.data).toEqual([{ id: records[0].id }, { id: records[1].id }]);
    expect(page.truncated).toBe(false);
    expect(page.meta.page_size).toBe(2);
    expect(decodeMcpKeysetCursor(page.meta.next_cursor ?? '')).toEqual({
      at: records[1].at.toISOString(),
      id: records[1].id,
    });
  });

  it('returns no cursor when the last page is reached', () => {
    const page = buildMcpKeysetPage({
      records: [item(2), item(1)],
      pageSize: 2,
      cursorOf: (record) => keysetCursorOf(record.at, record.id),
      mapRow: (record) => ({ id: record.id }),
    });

    expect(page.meta.next_cursor).toBeNull();
  });

  it('drops trailing rows past the 32 KB cap, reports truncated, and resumes after the last kept row', () => {
    const records = Array.from({ length: 25 }, (_, index) =>
      item(index + 1, 'z'.repeat(4000)),
    );

    const page = buildMcpKeysetPage({
      records,
      pageSize: 25,
      cursorOf: (record) => keysetCursorOf(record.at, record.id),
      mapRow: (record) => ({ id: record.id, blob: record.blob }),
    });

    const serializedBytes = Buffer.byteLength(JSON.stringify(page), 'utf8');
    expect(serializedBytes).toBeLessThanOrEqual(MCP_TOOL_RESULT_MAX_BYTES);
    expect(page.truncated).toBe(true);
    expect(page.data.length).toBeGreaterThan(0);
    expect(page.data.length).toBeLessThan(25);
    const lastKept = records[page.data.length - 1];
    expect(decodeMcpKeysetCursor(page.meta.next_cursor ?? '')).toEqual({
      at: lastKept.at.toISOString(),
      id: lastKept.id,
    });
  });

  it('keeps extra envelope fields and counts them against the cap', () => {
    const page = buildMcpKeysetPage({
      records: [item(1)],
      pageSize: 10,
      cursorOf: (record) => keysetCursorOf(record.at, record.id),
      mapRow: (record) => ({ id: record.id }),
      extra: { trace_id: TRACE_ID, audit_truncated: false },
    });

    expect(page).toMatchObject({
      trace_id: TRACE_ID,
      audit_truncated: false,
      truncated: false,
    });
  });
});
