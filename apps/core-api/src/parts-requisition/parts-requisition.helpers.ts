import { ConflictException } from '@nestjs/common';
import {
  PartsReservationStatus,
  PartsRequisitionStatus,
  Prisma,
} from '@prisma/client';

const ZERO = new Prisma.Decimal(0);

const ACTIVE_SLICE_STATUSES = new Set<PartsReservationStatus>([
  PartsReservationStatus.OPEN,
  PartsReservationStatus.ORDERED,
  PartsReservationStatus.STAGED,
]);

const SENT_SLICE_STATUSES = new Set<PartsReservationStatus>([
  PartsReservationStatus.ORDERED,
  PartsReservationStatus.STAGED,
]);

export type ReservationSliceState = {
  status: PartsReservationStatus;
  quantity: Prisma.Decimal | number | string;
  quantity_consumed: Prisma.Decimal | number | string;
  quantity_returned: Prisma.Decimal | number | string;
  quantity_staged: Prisma.Decimal | number | string;
};

export function getRemainingCommitment(
  slice: Pick<
    ReservationSliceState,
    'quantity' | 'quantity_consumed' | 'quantity_returned'
  >,
): Prisma.Decimal {
  const remaining = new Prisma.Decimal(slice.quantity)
    .sub(slice.quantity_consumed)
    .sub(slice.quantity_returned);
  return remaining.gt(ZERO) ? remaining : ZERO;
}

export function isActiveSlice(slice: ReservationSliceState): boolean {
  if (!ACTIVE_SLICE_STATUSES.has(slice.status)) {
    return false;
  }

  return (
    getRemainingCommitment(slice).gt(ZERO) ||
    new Prisma.Decimal(slice.quantity_staged).gt(ZERO)
  );
}

export function deriveRequisitionStatus(
  slices: readonly ReservationSliceState[],
): PartsRequisitionStatus {
  if (slices.length === 0) {
    return PartsRequisitionStatus.DRAFT;
  }

  if (
    slices.every((slice) => slice.status === PartsReservationStatus.CANCELLED)
  ) {
    return PartsRequisitionStatus.CANCELLED;
  }

  const hasFulfilled = slices.some(
    (slice) => slice.status === PartsReservationStatus.FULFILLED,
  );
  const hasActive = slices.some((slice) => isActiveSlice(slice));

  if (hasActive) {
    const hasSentSlice = slices.some((slice) =>
      SENT_SLICE_STATUSES.has(slice.status),
    );
    return hasFulfilled || hasSentSlice
      ? PartsRequisitionStatus.ORDERED
      : PartsRequisitionStatus.DRAFT;
  }

  return hasFulfilled
    ? PartsRequisitionStatus.COMPLETED
    : PartsRequisitionStatus.DRAFT;
}

export async function recomputeRequisitionStatus(
  tx: Prisma.TransactionClient,
  tenantId: string,
  requisitionId: string,
): Promise<void> {
  const requisition = await tx.partsRequisition.findFirst({
    where: { id: requisitionId, tenant_id: tenantId },
    select: { status: true },
  });
  if (
    !requisition ||
    requisition.status === PartsRequisitionStatus.CANCELLED ||
    requisition.status === PartsRequisitionStatus.COMPLETED
  ) {
    return;
  }

  const slices = await tx.partsReservation.findMany({
    where: {
      tenant_id: tenantId,
      requisition_line: { tenant_id: tenantId, requisition_id: requisitionId },
    },
    select: {
      status: true,
      quantity: true,
      quantity_consumed: true,
      quantity_returned: true,
      quantity_staged: true,
    },
    orderBy: { id: 'asc' },
  });

  const nextStatus = deriveRequisitionStatus(slices);
  if (nextStatus === requisition.status) {
    return;
  }

  const updated = await tx.partsRequisition.updateMany({
    where: {
      id: requisitionId,
      tenant_id: tenantId,
      status: requisition.status,
    },
    data: { status: nextStatus },
  });
  if (updated.count === 0) {
    throw new ConflictException(
      'Parts requisition status changed concurrently. Please refresh and try again.',
    );
  }
}
