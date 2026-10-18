import { toMcpWarrantyClaimListRow } from './mcp-compliance-read.mapper.js';

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
