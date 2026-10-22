import { Prisma } from '@prisma/client';
import { asFake } from '../invoices/invoice-fixtures.spec.support.js';
import {
  needsCustomerNotice,
  toOverrunView,
  type OverrunTrackingRow,
} from './workshop-estimate-overrun-tracking.helpers.js';

const warning = {
  total_over_threshold: true,
  new_work_lines: false,
  approved_total_gross: '192.00',
  current_total_gross: '230.00',
  threshold_pct: '15.00',
  new_line_count: 0,
};

const detected = asFake<OverrunTrackingRow>({
  id: 'row-1',
  detected_at: new Date('2026-10-12T08:00:00.000Z'),
  notified_at: null,
  notified_channel: null,
  notified_amount_gross: null,
  customer_reaction: null,
  note: null,
});

describe('needsCustomerNotice', () => {
  const noticed = (amount: string) => ({
    notified_at: new Date('2026-10-13T09:00:00.000Z'),
    notified_amount_gross: new Prisma.Decimal(amount),
  });

  it('asks for a notice until the customer has been told a total', () => {
    expect(
      needsCustomerNotice('230.00', {
        notified_at: null,
        notified_amount_gross: null,
      }),
    ).toBe(true);
  });

  it('does not ask again while the total is the one the customer was told', () => {
    expect(needsCustomerNotice('230.00', noticed('230.00'))).toBe(false);
    expect(needsCustomerNotice('230', noticed('230.00'))).toBe(false);
  });

  it('asks again once the total has moved since the customer was told', () => {
    expect(needsCustomerNotice('241.50', noticed('230.00'))).toBe(true);
  });
});

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
