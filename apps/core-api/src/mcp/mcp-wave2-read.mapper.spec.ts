import {
  isLoanerBookingOverdue,
  toMcpEstimateVersionRow,
  toMcpOrderCommunicationRow,
} from './mcp-wave2-read.mapper.js';
import { WorkshopEstimateStatus } from '@prisma/client';

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

  it('maps estimate rows with a null customer_ref when the order has no customer', () => {
    const mapped = toMcpEstimateVersionRow({
      id: '00000000-0000-4000-8000-000000000040',
      version: 1,
      status: WorkshopEstimateStatus.SENT,
      valid_until: null,
      sent_at: new Date('2026-10-01T10:00:00.000Z'),
      decided_at: null,
      channel: null,
      total_net: null,
      total_gross: null,
      estimate: {
        estimate_number: 'EST-2',
        workshop_order_id: '00000000-0000-4000-8000-000000000041',
        site_id: '00000000-0000-4000-8000-000000000042',
        workshop_order: {
          customer_id: null,
          order_number: 'WO-2',
        },
      },
    });
    expect(mapped.customer_ref).toBeNull();
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
