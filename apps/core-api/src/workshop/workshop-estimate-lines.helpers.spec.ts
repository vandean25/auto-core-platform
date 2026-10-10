import {
  Prisma,
  WorkshopLineItemType,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  buildWorkshopEstimateLines,
  buildWorkshopEstimateTotals,
  collectEstimateSourceLines,
  type EstimateSourceLine,
} from './workshop-estimate-lines.helpers.js';

const labor = (
  id: string,
  quantity: string,
  unitPrice: string,
): EstimateSourceLine => ({
  id,
  type: WorkshopLineItemType.LABOR,
  item_no: 'LAB-OIL',
  description: 'Ölwechsel',
  quantity: new Prisma.Decimal(quantity),
  unit_price: new Prisma.Decimal(unitPrice),
  part_execution_status: null,
});

describe('workshop estimate lines', () => {
  it('drops cancelled part lines and keeps every other line in task order', () => {
    const tasks = [
      {
        line_items: [
          labor('line-1', '2', '90'),
          {
            ...labor('line-2', '1', '40'),
            type: WorkshopLineItemType.PART,
            part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
          },
        ],
      },
      {
        line_items: [
          {
            ...labor('line-3', '1', '25'),
            type: WorkshopLineItemType.PART,
            part_execution_status: WorkshopPartLineExecutionStatus.CONSUMED,
          },
        ],
      },
    ];

    expect(collectEstimateSourceLines(tasks).map((line) => line.id)).toEqual([
      'line-1',
      'line-3',
    ]);
  });

  it('prices labor at quantity times hourly rate with VAT on top', () => {
    const [line] = buildWorkshopEstimateLines(
      [labor('line-1', '2', '90')],
      new Prisma.Decimal(20),
    );

    expect(line).toEqual({
      source_line_id: 'line-1',
      type: WorkshopLineItemType.LABOR,
      item_no: 'LAB-OIL',
      description: 'Ölwechsel',
      quantity: '2.000',
      unit_price: '90.00',
      tax_rate: '20.00',
      net: '180.00',
      tax: '36.00',
      gross: '216.00',
    });
  });

  it('rounds the line tax half-up to cents', () => {
    const [line] = buildWorkshopEstimateLines(
      [labor('line-1', '1', '0.03')],
      new Prisma.Decimal(20),
    );

    expect(line.net).toBe('0.03');
    expect(line.tax).toBe('0.01');
    expect(line.gross).toBe('0.04');
  });

  it('sums line amounts into the same totals the invoice snapshot uses', () => {
    const lines = buildWorkshopEstimateLines(
      [labor('line-1', '2', '90'), labor('line-2', '1', '50')],
      new Prisma.Decimal(20),
    );

    expect(buildWorkshopEstimateTotals(lines)).toEqual({
      total_net: '230.00',
      total_tax: '46.00',
      total_gross: '276.00',
      tax_breakdown: [{ rate: '20.00', net: '230.00', tax: '46.00', gross: '276.00' }],
    });
  });
});
