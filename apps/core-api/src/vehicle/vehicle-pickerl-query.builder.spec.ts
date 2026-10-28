import { VehiclePickerlQueryBuilder } from './vehicle-pickerl-query.builder.js';

describe('VehiclePickerlQueryBuilder', () => {
  const tenantId = 'tenant-1';
  const today = new Date('2026-10-13T12:00:00.000Z');

  describe('buildCustomerWhere', () => {
    it('scopes customer vehicles to the tenant without a window', () => {
      const { where, windowEndDate } = VehiclePickerlQueryBuilder.buildCustomerWhere(
        tenantId,
        {},
        today,
      );

      expect(where).toEqual({ tenant_id: tenantId, inventory_role: 'CUSTOMER' });
      expect(windowEndDate).toBeNull();
    });

    it('limits the window to inspections valid on or before the window end month', () => {
      const { where, windowEndDate } = VehiclePickerlQueryBuilder.buildCustomerWhere(
        tenantId,
        { window: 30 },
        today,
      );

      expect(windowEndDate).toEqual(new Date('2026-11-12T23:59:59.999Z'));
      expect(where.OR).toEqual([
        {
          inspection_records: {
            some: {
              OR: [
                { plaketten_valid_until_year: { lt: 2026 } },
                {
                  AND: [
                    { plaketten_valid_until_year: 2026 },
                    { plaketten_valid_until_month: { lt: 10 } },
                  ],
                },
              ],
            },
          },
        },
        {
          inspection_records: {
            some: {
              OR: [
                { plaketten_valid_until_year: { lt: 2026 } },
                {
                  AND: [
                    { plaketten_valid_until_year: 2026 },
                    { plaketten_valid_until_month: { lte: 11 } },
                  ],
                },
              ],
            },
          },
        },
      ]);
    });

    it('also matches vehicles without any inspection record when filtering UNKNOWN', () => {
      const { where } = VehiclePickerlQueryBuilder.buildCustomerWhere(
        tenantId,
        { window: 60, status: 'UNKNOWN' },
        today,
      );

      expect(where.OR).toHaveLength(3);
      expect(where.OR?.[2]).toEqual({ inspection_records: { none: {} } });
    });
  });

  describe('isWithinWindow', () => {
    const windowEndDate = new Date('2026-11-12T23:59:59.999Z');

    it('rejects rows whose status differs from the requested status', () => {
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'OK', due_month: '2026-10' },
          { status: 'DUE_SOON' },
          null,
        ),
      ).toBe(false);
    });

    it('keeps every row when no window is requested', () => {
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'OK', due_month: '2030-01' },
          {},
          null,
        ),
      ).toBe(true);
    });

    it('always keeps OVERDUE rows inside a window', () => {
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'OVERDUE', due_month: '2024-01' },
          { window: 30 },
          windowEndDate,
        ),
      ).toBe(true);
    });

    it('keeps rows that are due on or before the window end month', () => {
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'OK', due_month: '2026-10' },
          { window: 30 },
          windowEndDate,
        ),
      ).toBe(true);
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'DUE_SOON', due_month: '2026-11' },
          { window: 30 },
          windowEndDate,
        ),
      ).toBe(false);
    });

    it('keeps rows without a due month only for an explicit UNKNOWN status', () => {
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'UNKNOWN', due_month: null },
          { window: 30 },
          windowEndDate,
        ),
      ).toBe(false);
      expect(
        VehiclePickerlQueryBuilder.isWithinWindow(
          { status: 'UNKNOWN', due_month: null },
          { window: 30, status: 'UNKNOWN' },
          windowEndDate,
        ),
      ).toBe(true);
    });
  });

  describe('compareRows', () => {
    it('orders OVERDUE, DUE_SOON, OK and then UNKNOWN, using due month within a status', () => {
      const rows = [
        { pickerl_due: { status: 'OK', due_month: '2026-03' } },
        { pickerl_due: { status: 'UNKNOWN', due_month: null } },
        { pickerl_due: { status: 'OVERDUE', due_month: '2025-05' } },
        { pickerl_due: { status: 'DUE_SOON', due_month: '2026-11' } },
        { pickerl_due: { status: 'OVERDUE', due_month: '2025-02' } },
      ];

      const sorted = [...rows].sort((left, right) =>
        VehiclePickerlQueryBuilder.compareRows(left, right),
      );

      expect(sorted.map((row) => row.pickerl_due)).toEqual([
        { status: 'OVERDUE', due_month: '2025-02' },
        { status: 'OVERDUE', due_month: '2025-05' },
        { status: 'DUE_SOON', due_month: '2026-11' },
        { status: 'OK', due_month: '2026-03' },
        { status: 'UNKNOWN', due_month: null },
      ]);
    });
  });

  describe('resolvePage', () => {
    it('defaults to the first page of 25 rows', () => {
      expect(VehiclePickerlQueryBuilder.resolvePage({})).toEqual({
        page: 1,
        pageSize: 25,
        skip: 0,
      });
    });

    it('computes the skip offset from a requested page and size', () => {
      expect(VehiclePickerlQueryBuilder.resolvePage({ page: 3, pageSize: 10 })).toEqual({
        page: 3,
        pageSize: 10,
        skip: 20,
      });
    });

    it('clamps a larger page size to 50 and offsets by the clamped size (AUT-807)', () => {
      expect(VehiclePickerlQueryBuilder.resolvePage({ page: 2, pageSize: 200 })).toEqual({
        page: 2,
        pageSize: 50,
        skip: 50,
      });
    });

    it('falls back to defaults for non-positive page and size values', () => {
      expect(VehiclePickerlQueryBuilder.resolvePage({ page: 0, pageSize: -1 })).toEqual({
        page: 1,
        pageSize: 25,
        skip: 0,
      });
    });
  });
});
