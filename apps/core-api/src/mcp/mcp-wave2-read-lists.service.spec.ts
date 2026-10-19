import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { LoanerBookingStatus, WorkshopEstimateStatus } from '@prisma/client';
import { McpWave2ReadListsService } from './mcp-wave2-read-lists.service.js';
import { paginateCommunications } from './mcp-wave2-read.mapper.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000e1';
const SITE_ID = '00000000-0000-4000-8000-000000000002';

function createService(overrides: Partial<Record<string, unknown>> = {}) {
  return new McpWave2ReadListsService(
    overrides.loaners as never,
    overrides.estimates as never,
    overrides.checkIns as never,
    overrides.checkInMedia as never,
    overrides.inspections as never,
    overrides.staffAvailability as never,
    {
      getSiteId: jest.fn().mockResolvedValue(SITE_ID),
    } as never,
  );
}

describe('McpWave2ReadListsService', () => {
  describe('list_loaner_bookings', () => {
    it('keeps bookings that overlap the from/to window', async () => {
      const booking = {
        id: '00000000-0000-4000-8000-000000000010',
        status: LoanerBookingStatus.HANDED_OVER,
        loanerVehicleId: '00000000-0000-4000-8000-000000000011',
        customerId: '00000000-0000-4000-8000-000000000012',
        workshopOrderId: ORDER_ID,
        plannedFrom: new Date('2026-09-30T08:00:00.000Z'),
        plannedTo: new Date('2026-10-02T18:00:00.000Z'),
        handedOverAt: new Date('2026-09-30T08:00:00.000Z'),
        returnedAt: null,
        loanerVehicle: { displayName: 'Pool 1' },
        customer: { companyName: 'Demo GmbH' },
      };
      const service = createService({
        loaners: {
          listBookings: jest.fn().mockResolvedValue({ data: [booking] }),
        },
      });

      const page = await service.listLoanerBookings({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.000Z',
      });

      expect(page.data).toHaveLength(1);
      expect(page.data[0].id).toBe(booking.id);
    });

    it('returns an empty page when nothing matches', async () => {
      const service = createService({
        loaners: {
          listBookings: jest.fn().mockResolvedValue({ data: [] }),
        },
      });
      const page = await service.listLoanerBookings({});
      expect(page.data).toEqual([]);
      expect(page.meta.next_cursor).toBeNull();
    });
  });

  describe('list_estimates', () => {
    it('returns an empty page from the estimate service', async () => {
      const service = createService({
        estimates: {
          listVersionsForSite: jest.fn().mockResolvedValue({
            rows: [],
            nextCursor: null,
          }),
        },
      });
      const page = await service.listEstimates({ status: WorkshopEstimateStatus.SENT });
      expect(page.data).toEqual([]);
    });
  });

  describe('list_order_communications', () => {
    it('masks bodies and recipients', async () => {
      const service = createService({
        estimates: {
          listCommunicationsForOrder: jest.fn().mockResolvedValue({
            data: [
              {
                id: '00000000-0000-4000-8000-000000000020',
                kind: 'ESTIMATE_EMAIL',
                channel: 'EMAIL',
                version: 1,
                occurred_at: '2026-10-01T10:00:00.000Z',
                status: 'SENT',
                decision: null,
              },
            ],
          }),
        },
      });
      const page = await service.listOrderCommunications({ orderId: ORDER_ID });
      expect(page.data[0]).toMatchObject({
        recipient_masked: null,
        template_id: null,
      });
      expect(page.data[0]).not.toHaveProperty('body');
      expect(page.data[0]).not.toHaveProperty('subject');
    });
  });

  describe('get_check_in', () => {
    it('rethrows unexpected checklist errors', async () => {
      const service = createService({
        checkIns: {
          get: jest.fn().mockResolvedValue({
            status: 'DRAFT',
            damage_markers_json: [],
          }),
        },
        inspections: {
          getOrderCheckInChecklist: jest
            .fn()
            .mockRejectedValue(new Error('database offline')),
        },
        checkInMedia: {
          list: jest.fn().mockResolvedValue({ data: [] }),
        },
      });
      await expect(service.getCheckIn({ orderId: ORDER_ID })).rejects.toThrow(
        'database offline',
      );
    });

    it('omits signature image and hash fields', async () => {
      const service = createService({
        checkIns: {
          get: jest.fn().mockResolvedValue({
            status: 'COMPLETED',
            damage_markers_json: [],
            signed_at: '2026-10-01T12:00:00.000Z',
            signature_media_id: 'media-1',
            completed_at: '2026-10-01T12:00:00.000Z',
          }),
        },
        inspections: {
          getOrderCheckInChecklist: jest.fn().mockResolvedValue({ items: [] }),
        },
        checkInMedia: {
          list: jest.fn().mockResolvedValue({
            data: [{ id: 'media-1', purpose: 'SIGNATURE' }],
          }),
        },
      });
      const summary = await service.getCheckIn({ orderId: ORDER_ID });
      expect(summary.signature_captured).toBe(true);
      expect(summary).not.toHaveProperty('signature_image');
      expect(summary).not.toHaveProperty('content_hash');
      expect(summary.media).toEqual([{ id: 'media-1', purpose: 'SIGNATURE' }]);
    });
  });

  describe('getStaffAvailability', () => {
    it('surfaces MCP not_permitted from the HR service', async () => {
      const service = createService({
        staffAvailability: {
          getStaffAvailability: jest.fn().mockRejectedValue(
            new ForbiddenException({
              code: 'not_permitted',
              message: 'Tenant admin access is required.',
            }),
          ),
        },
      });
      await expect(service.getStaffAvailability({})).rejects.toMatchObject({
        response: { code: 'not_permitted' },
      });
    });

    it('returns an empty roster without leave or clock detail fields', async () => {
      const service = createService({
        staffAvailability: {
          getStaffAvailability: jest.fn().mockResolvedValue({
            date: '2026-10-01',
            site_id: SITE_ID,
            employees: [],
          }),
        },
      });
      const result = await service.getStaffAvailability({});
      expect(result.employees).toEqual([]);
      expect(result).not.toHaveProperty('leave_type');
      expect(result).not.toHaveProperty('clock_events');
    });
  });
});

describe('paginateCommunications overrun cursor', () => {
  it('does not repeat rows when detection and notification share an id', () => {
    const sharedId = '00000000-0000-4000-8000-000000000099';
    const rows = [
      {
        id: sharedId,
        at: '2026-10-02T10:00:00.000Z',
        event_type: 'OVERRUN_NOTIFICATION',
      },
      {
        id: sharedId,
        at: '2026-10-01T10:00:00.000Z',
        event_type: 'OVERRUN_DETECTED',
      },
      {
        id: '00000000-0000-4000-8000-000000000030',
        at: '2026-09-30T10:00:00.000Z',
        event_type: 'ESTIMATE_EMAIL',
      },
    ];
    const first = paginateCommunications(rows, 1);
    expect(first.data).toHaveLength(1);
    expect(first.meta.next_cursor).toBeTruthy();
    const second = paginateCommunications(rows, 1, first.meta.next_cursor ?? undefined);
    expect(second.data[0].event_type).toBe('OVERRUN_DETECTED');
    expect(second.data).not.toEqual(first.data);
    const third = paginateCommunications(rows, 2, second.meta.next_cursor ?? undefined);
    expect(third.data.map((row) => row.event_type)).toEqual(['ESTIMATE_EMAIL']);
  });
});
