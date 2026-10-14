import { PartsReservationStatus } from '@prisma/client';
import {
  buildWorkshopOrderRetargetData,
  releaseOrderReservationsForRetarget,
} from './workshop-intake-retarget.helpers.js';

describe('releaseOrderReservationsForRetarget', () => {
  function buildTx(reservations: Array<{ id: string }>) {
    return {
      partsReservation: {
        findMany: jest.fn().mockResolvedValue(reservations),
      },
    } as any;
  }

  it('releases every open, ordered or staged reservation of the order to the return location', async () => {
    const tx = buildTx([{ id: 'r-1' }, { id: 'r-2' }]);
    const partsRequisitionService = {
      releaseReservation: jest.fn().mockResolvedValue(undefined),
    };

    await releaseOrderReservationsForRetarget({
      tx,
      tenantId: 'tenant-1',
      orderId: 'wo-1',
      returnLocationId: 'loc-1',
      partsRequisitionService,
    });

    expect(tx.partsReservation.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        status: {
          in: [
            PartsReservationStatus.OPEN,
            PartsReservationStatus.ORDERED,
            PartsReservationStatus.STAGED,
          ],
        },
        workshop_task_line_item: {
          workshop_task: { workshop_order_id: 'wo-1' },
        },
      },
      select: { id: true },
    });
    expect(partsRequisitionService.releaseReservation).toHaveBeenNthCalledWith(
      1,
      'r-1',
      { returnLocationId: 'loc-1' },
      tx,
    );
    expect(partsRequisitionService.releaseReservation).toHaveBeenNthCalledWith(
      2,
      'r-2',
      { returnLocationId: 'loc-1' },
      tx,
    );
  });

  it('releases without a return location when the order has none', async () => {
    const tx = buildTx([{ id: 'r-1' }]);
    const partsRequisitionService = { releaseReservation: jest.fn() };

    await releaseOrderReservationsForRetarget({
      tx,
      tenantId: 'tenant-1',
      orderId: 'wo-1',
      returnLocationId: null,
      partsRequisitionService,
    });

    expect(partsRequisitionService.releaseReservation).toHaveBeenCalledWith(
      'r-1',
      {},
      tx,
    );
  });

  it('does nothing when the order holds no active reservations', async () => {
    const tx = buildTx([]);
    const partsRequisitionService = { releaseReservation: jest.fn() };

    await releaseOrderReservationsForRetarget({
      tx,
      tenantId: 'tenant-1',
      orderId: 'wo-1',
      returnLocationId: 'loc-1',
      partsRequisitionService,
    });

    expect(partsRequisitionService.releaseReservation).not.toHaveBeenCalled();
  });
});

describe('buildWorkshopOrderRetargetData', () => {
  const existing = {
    reported_issue: 'Brakes',
    notes: null,
    mechanic_id: 'm-1',
    scheduled_start_at: new Date('2026-10-20T08:00:00Z'),
    scheduled_end_at: new Date('2026-10-20T10:00:00Z'),
  };

  it('moves the order to the target site and bay, clears staging and parses the dto dates', () => {
    const data = buildWorkshopOrderRetargetData(existing, {
      siteId: 'site-2',
      bayId: 'bay-2',
      scheduledStartAt: '2026-10-21T08:00:00.000Z',
      scheduledEndAt: '2026-10-21T10:00:00.000Z',
    });

    expect(data).toEqual(
      expect.objectContaining({
        site_id: 'site-2',
        bay_id: 'bay-2',
        staging_location_id: null,
        scheduled_start_at: new Date('2026-10-21T08:00:00.000Z'),
        scheduled_end_at: new Date('2026-10-21T10:00:00.000Z'),
      }),
    );
  });

  it('keeps the existing mechanic and schedule when the dto omits them', () => {
    const data = buildWorkshopOrderRetargetData(existing, {
      siteId: 'site-2',
      bayId: 'bay-2',
    });

    expect(data).toEqual(
      expect.objectContaining({
        mechanic_id: 'm-1',
        scheduled_start_at: existing.scheduled_start_at,
        scheduled_end_at: existing.scheduled_end_at,
      }),
    );
  });
});
