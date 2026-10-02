import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { TyreSet, TyreSetEventType, TyreSetStatus } from '@prisma/client';

export type TyreSetEventPatch = {
  status: TyreSetStatus;
  location_id: string | null;
  stored_since: Date | null;
};

export function assertEventAllowed(
  currentStatus: TyreSetStatus,
  eventType: TyreSetEventType,
): void {
  if (eventType === 'CHECK_IN' && currentStatus === 'IN_STORAGE') {
    throw new ConflictException('Tyre set is already checked in to storage.');
  }
  if (eventType === 'CHECK_OUT' && currentStatus !== 'IN_STORAGE') {
    throw new ConflictException(
      'Check-out is only allowed while the set is in storage.',
    );
  }
  if (eventType === 'MOVED' && currentStatus !== 'IN_STORAGE') {
    throw new UnprocessableEntityException(
      'Moves are only allowed while the set is in storage.',
    );
  }
  if (eventType === 'DISPOSED' && currentStatus === 'DISPOSED') {
    throw new ConflictException('Tyre set is already disposed.');
  }
}

export function applyTyreSetEvent(
  set: Pick<TyreSet, 'status' | 'location_id' | 'stored_since'>,
  eventType: TyreSetEventType,
  toLocationId: string | null,
  occurredAt: Date,
): TyreSetEventPatch {
  assertEventAllowed(set.status, eventType);

  switch (eventType) {
    case 'CHECK_IN':
      return {
        status: 'IN_STORAGE',
        location_id: toLocationId,
        stored_since: occurredAt,
      };
    case 'CHECK_OUT':
      return {
        status: 'ON_VEHICLE',
        location_id: null,
        stored_since: set.stored_since,
      };
    case 'MOVED':
      if (!toLocationId) {
        throw new UnprocessableEntityException(
          'Move requires a destination location.',
        );
      }
      return {
        status: 'IN_STORAGE',
        location_id: toLocationId,
        stored_since: set.stored_since,
      };
    case 'DISPOSED':
      return {
        status: 'DISPOSED',
        location_id: null,
        stored_since: set.stored_since,
      };
    case 'INSPECTED':
      return {
        status: set.status,
        location_id: set.location_id,
        stored_since: set.stored_since,
      };
    default:
      throw new UnprocessableEntityException('Unsupported tyre set event type');
  }
}

export function projectTyreSetStateFromEvents(
  events: Array<{
    event_type: TyreSetEventType;
    to_location_id: string | null;
    occurred_at: Date;
  }>,
): TyreSetEventPatch {
  let status: TyreSetStatus = 'RETURNED';
  let location_id: string | null = null;
  let stored_since: Date | null = null;

  const ordered = [...events].sort(
    (a, b) => a.occurred_at.getTime() - b.occurred_at.getTime(),
  );

  for (const event of ordered) {
    const patch = applyTyreSetEvent(
      { status, location_id, stored_since },
      event.event_type,
      event.to_location_id,
      event.occurred_at,
    );
    status = patch.status;
    location_id = patch.location_id;
    stored_since = patch.stored_since;
  }

  return { status, location_id, stored_since };
}

export function assertSetMatchesEventLedger(
  set: Pick<TyreSet, 'status' | 'location_id' | 'stored_since'>,
  events: Array<{
    event_type: TyreSetEventType;
    to_location_id: string | null;
    occurred_at: Date;
  }>,
): void {
  if (events.length === 0) {
    return;
  }
  const projected = projectTyreSetStateFromEvents(events);
  if (projected.status !== set.status) {
    throw new ConflictException('Tyre set status does not match event ledger.');
  }
  if (projected.location_id !== set.location_id) {
    throw new ConflictException(
      'Tyre set location does not match event ledger.',
    );
  }
}
