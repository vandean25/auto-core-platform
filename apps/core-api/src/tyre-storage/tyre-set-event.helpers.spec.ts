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
    expect(projected.status).toBe('ON_VEHICLE');
    expect(projected.location_id).toBeNull();
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
});
