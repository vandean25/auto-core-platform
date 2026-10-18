import {
  toMcpGewaehrleistungDueRow,
  toMcpWarrantyClaimListRow,
} from './mcp-compliance-read.mapper.js';

describe('toMcpGewaehrleistungDueRow', () => {
  it('uses Customer.type for customer_name, not company_name presence', () => {
    const row = toMcpGewaehrleistungDueRow({
      id: 'sale-1',
      sale_number: 'S-1',
      vehicle_id: 'veh-1',
      customer_id: 'cust-1',
      handed_over_at: null,
      gewaehrleistung_ends_on: new Date('2028-01-01'),
      presumption_ends_on: null,
      gewaehrleistung_rule_version: 'v1',
      vehicle: {
        id: 'veh-1',
        make: 'Make',
        model: 'Model',
        year: 2024,
        vin: null,
        plate: null,
      },
      customer: {
        type: 'PRIVATE',
        company_name: 'Stale GmbH',
        first_name: 'Anna',
        last_name: 'Muster',
      },
    });

    expect(row.customer_name).toBe('Anna Muster');
  });
});

describe('toMcpWarrantyClaimListRow', () => {
  it('omits complaint and decision note text', () => {
    const row = toMcpWarrantyClaimListRow({
      id: '00000000-0000-4000-8000-000000000001',
      workshopOrderId: '00000000-0000-4000-8000-000000000002',
      type: 'GARANTIE',
      status: 'DRAFT',
      complaint: 'secret complaint',
      causeCorrection: 'secret cause',
      claimedAmountNet: '10.00',
      linesNetAmount: '10.00',
      externalReference: null,
      decisionDate: null,
      decisionNote: 'secret note',
      submittedAt: null,
      closedAt: null,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z',
      lines: [{ id: 'line-1' } as never],
    });

    expect(row).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      line_count: 1,
    });
    expect(row).not.toHaveProperty('complaint');
    expect(row).not.toHaveProperty('decision_note');
  });
});
