import { toMcpOrderCommunicationRow } from './mcp-wave2-read.mapper.js';
import { isLoanerBookingOverdue } from './mcp-wave2-read.mapper.js';

describe('mcp-wave2-read.mapper', () => {
  it('masks communication rows without bodies', () => {
    const row = toMcpOrderCommunicationRow({
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'ESTIMATE_EMAIL',
      channel: 'EMAIL',
      version: 1,
      occurred_at: '2026-10-01T10:00:00.000Z',
      status: 'SENT',
      decision: null,
    });
    expect(row.recipient_masked).toBeNull();
    expect(row.template_id).toBeNull();
    expect(row.direction).toBe('OUTBOUND');
  });

  it('detects overdue loaner bookings', () => {
    const overdue = isLoanerBookingOverdue(
      {
        status: 'HANDED_OVER',
        plannedTo: new Date('2026-10-01T00:00:00.000Z'),
        returnedAt: null,
      },
      new Date('2026-10-02T00:00:00.000Z'),
    );
    expect(overdue).toBe(true);
  });
});
