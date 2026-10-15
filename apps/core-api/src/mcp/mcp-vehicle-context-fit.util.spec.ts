import { MCP_TOOL_RESULT_MAX_BYTES } from './mcp.constants.js';
import { encodeMcpVehicleContextCursor } from './mcp-vehicle-context.mapper.js';
import { fitVehicleContextPayloadToCap } from './mcp-vehicle-context-fit.util.js';

const ROW_ID = '00000000-0000-4000-8000-000000000001';

function fatRow(prefix: string) {
  return {
    id: ROW_ID,
    number: `${prefix}-${'x'.repeat(200)}`,
    status: 'INTAKE',
    opened_at: '2026-01-01T00:00:00.000Z',
    workshop_order_ref: ROW_ID,
    padding: 'y'.repeat(400),
  };
}

describe('fitVehicleContextPayloadToCap', () => {
  it('keeps a full multi-section page within the byte cap with a usable cursor', () => {
    const payload = {
      vehicle_id: ROW_ID,
      as_of: '2026-10-15T12:00:00.000Z',
      disclaimer: 'Context only',
      site_id: ROW_ID,
      sections: {
        identity: {
          state: 'ok' as const,
          data: { vehicle: { id: ROW_ID, make: 'A', model: 'B', year: 2020 } },
        },
        open_workshop: {
          state: 'ok' as const,
          data: Array.from({ length: 25 }, (_, index) => fatRow(`wo-${index}`)),
          meta: {
            total: 25,
            page_size: 25,
            next_cursor: encodeMcpVehicleContextCursor({
              section: 'open_workshop',
              keyset: { at: '2026-01-01T00:00:00.000Z', id: ROW_ID },
            }),
          },
          incomplete: true,
        },
        inspections: {
          state: 'ok' as const,
          data: Array.from({ length: 25 }, (_, index) => ({
            id: ROW_ID,
            inspection_type: 'PICKERL_57A',
            inspected_on: '2026-03-01',
            plaketten_valid_until: '2028-03',
            station_name: `Station ${index}`,
            value_source: {
              table: 'vehicle_inspection_record',
              resolved_pickerl_rule_id: 'm1-legacy-pre-2027',
            },
            limits: {
              includes_notes: false,
              sticker_validity_is_month_granularity: true,
              interval_years: [3, 2, 1],
              tolerance_months_before: 1,
              tolerance_months_after: 4,
            },
            padding: 'z'.repeat(300),
          })),
          meta: { total: 25, page_size: 25, next_cursor: null },
        },
      },
    };

    const fitted = fitVehicleContextPayloadToCap(payload);
    expect(Buffer.byteLength(JSON.stringify(fitted), 'utf8')).toBeLessThanOrEqual(
      MCP_TOOL_RESULT_MAX_BYTES,
    );
    const workshop = fitted.sections.open_workshop;
    expect(workshop?.state).toBe('ok');
    if (workshop?.state === 'ok') {
      expect(workshop.data.length).toBeLessThan(25);
      expect(workshop.truncated).toBe(true);
      expect(workshop.incomplete).toBe(true);
      expect(workshop.meta?.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});
