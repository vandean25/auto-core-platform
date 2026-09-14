import {
  PartsReservationStatus,
  PartsRequisitionStatus,
  WorkshopPartLineExecutionStatus,
} from '@prisma/client';
import {
  allocateStagedConsumption,
  deriveRequisitionStatus,
  isTaskBlockedByParts,
  recomputeRequisitionStatus,
  type ReservationSliceState,
} from './parts-requisition.helpers.js';

const slice = (
  overrides: Partial<ReservationSliceState> = {},
): ReservationSliceState => ({
  status: PartsReservationStatus.OPEN,
  quantity: '4.000',
  quantity_consumed: '0.000',
  quantity_returned: '0.000',
  quantity_staged: '0.000',
  ...overrides,
});

describe('deriveRequisitionStatus', () => {
  it('keeps an empty sheet in DRAFT', () => {
    expect(deriveRequisitionStatus([])).toBe(PartsRequisitionStatus.DRAFT);
  });

  it('stays DRAFT while only the draft purchase order exists', () => {
    expect(deriveRequisitionStatus([slice()])).toBe(
      PartsRequisitionStatus.DRAFT,
    );
  });

  it('becomes ORDERED once a slice is on a sent purchase order', () => {
    expect(
      deriveRequisitionStatus([
        slice({ status: PartsReservationStatus.ORDERED }),
      ]),
    ).toBe(PartsRequisitionStatus.ORDERED);
  });

  it('completes when a fulfilled slice has no active commitment', () => {
    expect(
      deriveRequisitionStatus([
        slice({
          status: PartsReservationStatus.FULFILLED,
          quantity_consumed: '4.000',
        }),
      ]),
    ).toBe(PartsRequisitionStatus.COMPLETED);
  });

  it('completes a mixed fulfilled and cancelled sheet', () => {
    expect(
      deriveRequisitionStatus([
        slice({
          status: PartsReservationStatus.FULFILLED,
          quantity_consumed: '2.000',
        }),
        slice({ status: PartsReservationStatus.CANCELLED }),
      ]),
    ).toBe(PartsRequisitionStatus.COMPLETED);
  });

  it('cancels only when every slice is cancelled', () => {
    expect(
      deriveRequisitionStatus([
        slice({ status: PartsReservationStatus.CANCELLED }),
        slice({ status: PartsReservationStatus.CANCELLED }),
      ]),
    ).toBe(PartsRequisitionStatus.CANCELLED);
  });

  it('stays ORDERED while a fulfilled slice still has an active sibling', () => {
    expect(
      deriveRequisitionStatus([
        slice({
          status: PartsReservationStatus.FULFILLED,
          quantity_consumed: '2.000',
        }),
        slice({ status: PartsReservationStatus.OPEN }),
      ]),
    ).toBe(PartsRequisitionStatus.ORDERED);
  });
});

describe('allocateStagedConsumption', () => {
  it('allocates requested quantity FIFO across staged slices', () => {
    const allocations = allocateStagedConsumption(
      [
        {
          id: 'older',
          status: PartsReservationStatus.STAGED,
          quantity: '4',
          quantity_consumed: '0',
          quantity_returned: '0',
          quantity_staged: '1.5',
        },
        {
          id: 'newer',
          status: PartsReservationStatus.STAGED,
          quantity: '2',
          quantity_consumed: '0',
          quantity_returned: '0',
          quantity_staged: '2',
        },
      ],
      '2',
    );

    expect(allocations).toEqual([
      { reservationId: 'older', quantity: '1.5' },
      { reservationId: 'newer', quantity: '0.5' },
    ]);
  });
});

describe('isTaskBlockedByParts', () => {
  it('ignores cancelled formula demand and fulfilled slices', () => {
    expect(
      isTaskBlockedByParts({
        lines: [
          {
            part_execution_status: WorkshopPartLineExecutionStatus.CANCELLED,
          },
        ],
        reservations: [],
      }),
    ).toBe(false);
  });
});

describe('recomputeRequisitionStatus', () => {
  it('does not modify terminal CANCELLED or COMPLETED requisitions', async () => {
    const mockTx = {
      partsRequisition: {
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      partsReservation: {
        findMany: jest.fn(),
      },
    } as any;

    // Terminal CANCELLED
    mockTx.partsRequisition.findFirst.mockResolvedValueOnce({
      status: PartsRequisitionStatus.CANCELLED,
    });
    await recomputeRequisitionStatus(mockTx, 'tenant-1', 'req-1');
    expect(mockTx.partsReservation.findMany).not.toHaveBeenCalled();
    expect(mockTx.partsRequisition.updateMany).not.toHaveBeenCalled();

    // Terminal COMPLETED
    mockTx.partsRequisition.findFirst.mockResolvedValueOnce({
      status: PartsRequisitionStatus.COMPLETED,
    });
    await recomputeRequisitionStatus(mockTx, 'tenant-1', 'req-2');
    expect(mockTx.partsReservation.findMany).not.toHaveBeenCalled();
    expect(mockTx.partsRequisition.updateMany).not.toHaveBeenCalled();
  });
});
