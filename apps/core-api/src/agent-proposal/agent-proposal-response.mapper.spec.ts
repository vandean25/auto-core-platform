import {
  buildEffectiveSummary,
  toAgentProposalResponseDto,
} from './agent-proposal-response.mapper.js';

const decidedAt = new Date('2026-01-02T03:04:05.000Z');

const proposalRow = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'p-1',
    tenant_id: 't-1',
    trace_id: 'tr-1',
    action_type: 'customer.update',
    tier: 'PROPOSE',
    status: 'PENDING',
    payload_json: { customer_id: 'c-1' },
    preview_json: null,
    created_by_agent: 'agent-1',
    decided_by: null,
    decided_at: null,
    reason: null,
    expires_at: new Date('2026-01-03T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T12:00:00.000Z'),
    ...overrides,
  }) as any;

describe('toAgentProposalResponseDto', () => {
  it('maps scalar fields and serialises dates as ISO strings', () => {
    const dto = toAgentProposalResponseDto(proposalRow());

    expect(dto).toMatchObject({
      id: 'p-1',
      tenant_id: 't-1',
      trace_id: 'tr-1',
      action_type: 'customer.update',
      tier: 'PROPOSE',
      status: 'PENDING',
      payload_json: { customer_id: 'c-1' },
      preview_json: null,
      created_by_agent: 'agent-1',
      expires_at: '2026-01-03T00:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T12:00:00.000Z',
    });
  });

  it('resolves the decider from the contact map', () => {
    const deciders = new Map([
      ['u-1', { name: 'Sam Supervisor', email: 'sam@example.com' }],
    ]);

    const dto = toAgentProposalResponseDto(
      proposalRow({ decided_by: 'u-1', decided_at: decidedAt, status: 'APPROVED' }),
      new Map(),
      deciders,
    );

    expect(dto).toMatchObject({
      decided_by: 'u-1',
      decided_by_name: 'Sam Supervisor',
      decided_by_email: 'sam@example.com',
      decided_at: '2026-01-02T03:04:05.000Z',
    });
  });

  it('returns null decider fields when the decider is not in the map', () => {
    const dto = toAgentProposalResponseDto(
      proposalRow({ decided_by: 'u-9', decided_at: decidedAt }),
      new Map(),
      new Map(),
    );

    expect(dto.decided_by_name).toBeNull();
    expect(dto.decided_by_email).toBeNull();
  });

  it('ignores contacts for an undecided proposal', () => {
    const deciders = new Map([
      ['u-1', { name: 'Sam Supervisor', email: 'sam@example.com' }],
    ]);

    const dto = toAgentProposalResponseDto(proposalRow(), new Map(), deciders);

    expect(dto.decided_at).toBeNull();
    expect(dto.decided_by_name).toBeNull();
    expect(dto.decided_by_email).toBeNull();
  });

  it('attaches the order summary only for workshop line actions', () => {
    const summary = {
      id: 'wo-9',
      order_number: 'WO-9',
      customer_name: null,
      vehicle_registration: null,
      vehicle_description: null,
    };
    const summaries = new Map([['wo-9', summary]]);

    const lineDto = toAgentProposalResponseDto(
      proposalRow({
        action_type: 'workshop_order.add_line',
        payload_json: { order_id: 'wo-9', amount_eur: 50 },
      }),
      summaries,
    );
    const otherDto = toAgentProposalResponseDto(
      proposalRow({ payload_json: { order_id: 'wo-9' } }),
      summaries,
    );

    expect(lineDto.workshop_order_summary).toBe(summary);
    expect(otherDto.workshop_order_summary).toBeNull();
  });

  it('returns an empty payload when the stored payload is null', () => {
    const dto = toAgentProposalResponseDto(proposalRow({ payload_json: null }));

    expect(dto.payload_json).toEqual({});
    expect(dto.effective_summary).toEqual({
      target_type: 'Customer',
      target_id: null,
      amount_eur: null,
    });
  });
});

describe('buildEffectiveSummary', () => {
  it('describes a customer update by its customer', () => {
    expect(
      buildEffectiveSummary('customer.update', { customer_id: 'c-1' }),
    ).toEqual({ target_type: 'Customer', target_id: 'c-1', amount_eur: null });
  });

  it('describes a workshop line by its order and line total', () => {
    expect(
      buildEffectiveSummary('workshop_order.add_line', {
        order_id: 'wo-1',
        unit_price: 20,
        quantity: 2,
      }),
    ).toEqual({
      target_type: 'WorkshopOrder',
      target_id: 'wo-1',
      amount_eur: 40,
    });
  });

  it('describes other actions from their entity fields', () => {
    expect(
      buildEffectiveSummary('invoice.issue', {
        entityType: 'Invoice',
        entityId: 'inv-1',
        amount: 12,
      }),
    ).toEqual({ target_type: 'Invoice', target_id: 'inv-1', amount_eur: 12 });
  });

  it('keeps the target and reports no amount when the amount is refused', () => {
    expect(
      buildEffectiveSummary('invoice.issue', {
        entity_type: 'Invoice',
        entity_id: 'inv-2',
        amount_eur: -5,
      }),
    ).toEqual({ target_type: 'Invoice', target_id: 'inv-2', amount_eur: null });
  });
});
