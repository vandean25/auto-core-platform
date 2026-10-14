import { Prisma } from '@prisma/client';
import { toOverrunView, type OverrunTrackingRow } from './workshop-estimate-overrun-tracking.helpers';

const warning = {
  total_over_threshold: true,
  new_work_lines: false,
  approved_total_gross: '192.00',
  current_total_gross: '230.00',
  threshold_pct: '15.00',
  new_line_count: 0,
};

const detected: OverrunTrackingRow = {
  id: 'row-1',
  detected_at: new Date('2026-10-12T08:00:00.000Z'),
  notified_at: null,
  notified_channel: null,
  notified_amount_gross: null,
  customer_reaction: null,
  note: null,
};

describe('toOverrunView', () => {
  it('shows the detection time and asks for a customer notice until one is recorded', () => {
    const view = toOverrunView(warning, detected);

    expect(view).toMatchObject({
      total_over_threshold: true,
      detected_at: '2026-10-12T08:00:00.000Z',
      notified_at: null,
      requires_customer_notice: true,
    });
  });

  it('carries the notice fields and stops asking once the customer was told', () => {
    const view = toOverrunView(warning, {
      ...detected,
      notified_at: new Date('2026-10-12T10:00:00.000Z'),
      notified_channel: 'PHONE',
      notified_amount_gross: new Prisma.Decimal('230'),
      customer_reaction: 'AGREED',
      note: 'Zugestimmt',
    });

    expect(view).toMatchObject({
      notified_at: '2026-10-12T10:00:00.000Z',
      notified_channel: 'PHONE',
      notified_amount_gross: '230.00',
      customer_reaction: 'AGREED',
      note: 'Zugestimmt',
      requires_customer_notice: false,
    });
  });
});
