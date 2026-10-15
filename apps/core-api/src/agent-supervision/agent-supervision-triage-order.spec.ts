import {
  compareSupervisionTriageCandidates,
  decodeSupervisionTriageCursor,
  encodeSupervisionTriageCursor,
  InvalidSupervisionTriageCursorError,
  paginateSupervisionTriageCandidates,
  sortSupervisionTriageCandidates,
  type SupervisionTriageCandidate,
} from './agent-supervision-triage-order.js';

function item(
  overrides: Partial<SupervisionTriageCandidate> &
    Pick<SupervisionTriageCandidate, 'kind' | 'entity_id'>,
): SupervisionTriageCandidate {
  return {
    site_id: 'site-1',
    reason: 'TEST',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    due_at: null,
    record_link: '/test',
    allowed_action: 'OPEN_RECORD',
    ...overrides,
  };
}

describe('supervision triage ordering', () => {
  it('orders kinds as overdue loaner, customer waiting, then pending approval', () => {
    const sorted = sortSupervisionTriageCandidates([
      item({ kind: 'PENDING_APPROVAL', entity_id: 'p-1' }),
      item({ kind: 'CUSTOMER_WAITING', entity_id: 'c-1' }),
      item({ kind: 'OVERDUE_LOANER', entity_id: 'l-1' }),
    ]);

    expect(sorted.map((row) => row.kind)).toEqual([
      'OVERDUE_LOANER',
      'CUSTOMER_WAITING',
      'PENDING_APPROVAL',
    ]);
  });

  it('breaks ties on equal due_at by created_at then entity_id', () => {
    const due = new Date('2026-02-01T12:00:00.000Z');
    const left = item({
      kind: 'PENDING_APPROVAL',
      entity_id: 'b-proposal',
      due_at: due,
      created_at: new Date('2026-01-02T00:00:00.000Z'),
    });
    const right = item({
      kind: 'PENDING_APPROVAL',
      entity_id: 'a-proposal',
      due_at: due,
      created_at: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(compareSupervisionTriageCandidates(left, right)).toBeGreaterThan(0);
    expect(sortSupervisionTriageCandidates([left, right]).map((r) => r.entity_id)).toEqual([
      'a-proposal',
      'b-proposal',
    ]);
  });

  it('paginates with a keyset cursor on the last row sort key', () => {
    const sorted = sortSupervisionTriageCandidates([
      item({ kind: 'OVERDUE_LOANER', entity_id: 'l-2' }),
      item({ kind: 'OVERDUE_LOANER', entity_id: 'l-1' }),
      item({ kind: 'CUSTOMER_WAITING', entity_id: 'c-1' }),
    ]);

    const first = paginateSupervisionTriageCandidates(sorted, 2);
    expect(first.page.map((row) => row.entity_id)).toEqual(['l-1', 'l-2']);
    expect(first.next_cursor).not.toBeNull();
    expect(decodeSupervisionTriageCursor(first.next_cursor!)).toMatchObject({
      kind: 'OVERDUE_LOANER',
      entity_id: 'l-2',
    });

    const second = paginateSupervisionTriageCandidates(
      sorted,
      2,
      first.next_cursor ?? undefined,
    );
    expect(second.page.map((row) => row.entity_id)).toEqual(['c-1']);
    expect(second.next_cursor).toBeNull();
  });

  it('rejects invalid cursors', () => {
    expect(() => decodeSupervisionTriageCursor('not-valid')).toThrow(
      InvalidSupervisionTriageCursorError,
    );
    expect(() =>
      paginateSupervisionTriageCandidates([], 10, 'not-valid'),
    ).toThrow(InvalidSupervisionTriageCursorError);
  });

  it('round-trips keyset cursors through encode/decode', () => {
    const row = item({
      kind: 'PENDING_APPROVAL',
      entity_id: 'p-99',
      due_at: new Date('2026-03-01T00:00:00.000Z'),
      created_at: new Date('2026-02-01T00:00:00.000Z'),
    });
    const raw = encodeSupervisionTriageCursor(row);
    expect(decodeSupervisionTriageCursor(raw)).toEqual({
      kind: 'PENDING_APPROVAL',
      due_at: '2026-03-01T00:00:00.000Z',
      created_at: '2026-02-01T00:00:00.000Z',
      entity_id: 'p-99',
    });
  });
});
