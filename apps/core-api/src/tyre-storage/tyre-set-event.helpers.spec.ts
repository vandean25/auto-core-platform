import {
  applyTyreSetEvent,
  projectTyreSetStateFromEvents,
} from './tyre-set-event.helpers.js';

describe('tyre-set-event.helpers', () => {
  it('projects status and location from check-in, move, and check-out', () => {
    const t0 = new Date('2026-01-10T10:00:00.000Z');
    const t1 = new Date('2026-02-01T10:00:00.000Z');
    const t2 = new Date('2026-03-01T10:00:00.000Z');
    const projected = projectTyreSetStateFromEvents([
      { event_type: 'CHECK_IN', to_location_id: 'loc-a', occurred_at: t0 },
      { event_type: 'MOVED', to_location_id: 'loc-b', occurred_at: t1 },
      { event_type: 'CHECK_OUT', to_location_id: null, occurred_at: t2 },
    ]);
    expect(projected.status).toBe('RETURNED');
    expect(projected.location_id).toBeNull();
  });

  it('rejects storage events after disposal', () => {
    expect(() =>
      applyTyreSetEvent(
        { status: 'DISPOSED', location_id: null, stored_since: null },
        'CHECK_IN',
        'loc-a',
        new Date(),
      ),
    ).toThrow('disposed');
  });

  it('rejects double check-in', () => {
    expect(() =>
      applyTyreSetEvent(
        { status: 'IN_STORAGE', location_id: 'loc-a', stored_since: new Date() },
        'CHECK_IN',
        'loc-b',
        new Date(),
      ),
    ).toThrow('already checked in');
  });

  it('projects status NEW when no events exist', () => {
    const projected = projectTyreSetStateFromEvents([]);
    expect(projected.status).toBe('NEW');
    expect(projected.location_id).toBeNull();
    expect(projected.stored_since).toBeNull();
  });

  it('allows check-in from NEW status to IN_STORAGE', () => {
    const occurredAt = new Date('2026-04-01T10:00:00.000Z');
    const patch = applyTyreSetEvent(
      { status: 'NEW', location_id: null, stored_since: null },
      'CHECK_IN',
      'loc-a',
      occurredAt,
    );
    expect(patch.status).toBe('IN_STORAGE');
    expect(patch.location_id).toBe('loc-a');
    expect(patch.stored_since).toEqual(occurredAt);
  });

  it('rejects check-out and move when status is NEW', () => {
    expect(() =>
      applyTyreSetEvent(
        { status: 'NEW', location_id: null, stored_since: null },
        'CHECK_OUT',
        null,
        new Date(),
      ),
    ).toThrow('only allowed while the set is in storage');

    expect(() =>
      applyTyreSetEvent(
        { status: 'NEW', location_id: null, stored_since: null },
        'MOVED',
        'loc-b',
        new Date(),
      ),
    ).toThrow('only allowed while the set is in storage');
  });
});
