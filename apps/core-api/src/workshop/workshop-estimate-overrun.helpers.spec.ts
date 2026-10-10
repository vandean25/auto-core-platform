import { Prisma } from '@prisma/client';
import { computeWorkshopEstimateOverrun } from './workshop-estimate-overrun.helpers.js';

const approved = {
  total_gross: '100.00',
  lines: [{ source_line_id: 'line-1' }, { source_line_id: 'line-2' }],
};

describe('workshop estimate overrun warning', () => {
  it('stays silent until a version has been approved', () => {
    expect(
      computeWorkshopEstimateOverrun({
        approved: null,
        currentLines: [{ source_line_id: 'line-9', gross: '999.00' }],
        thresholdPct: 15,
      }),
    ).toBeNull();
  });

  it('stays silent while the total is within the threshold and no lines are new', () => {
    expect(
      computeWorkshopEstimateOverrun({
        approved,
        currentLines: [
          { source_line_id: 'line-1', gross: '60.00' },
          { source_line_id: 'line-2', gross: '55.00' },
        ],
        thresholdPct: 15,
      }),
    ).toBeNull();
  });

  it('warns when the gross total exceeds approved × (1 + threshold)', () => {
    const warning = computeWorkshopEstimateOverrun({
      approved,
      currentLines: [
        { source_line_id: 'line-1', gross: '60.00' },
        { source_line_id: 'line-2', gross: '55.01' },
      ],
      thresholdPct: new Prisma.Decimal(15),
    });

    expect(warning).toEqual({
      total_over_threshold: true,
      new_work_lines: false,
      approved_total_gross: '100.00',
      current_total_gross: '115.01',
      threshold_pct: '15.00',
      new_line_count: 0,
    });
  });

  it('does not warn at exactly the threshold', () => {
    expect(
      computeWorkshopEstimateOverrun({
        approved,
        currentLines: [
          { source_line_id: 'line-1', gross: '60.00' },
          { source_line_id: 'line-2', gross: '55.00' },
        ],
        thresholdPct: '15',
      }),
    ).toBeNull();
  });

  it('warns about new work lines even when the total stays flat', () => {
    const warning = computeWorkshopEstimateOverrun({
      approved,
      currentLines: [
        { source_line_id: 'line-1', gross: '60.00' },
        { source_line_id: 'line-2', gross: '30.00' },
        { source_line_id: 'line-3', gross: '10.00' },
      ],
      thresholdPct: 15,
    });

    expect(warning).toMatchObject({
      total_over_threshold: false,
      new_work_lines: true,
      new_line_count: 1,
    });
  });
});
