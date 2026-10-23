import {
  toVehicleDetailResponse,
  toVehicleListResponse,
} from './vehicle-response.mapper.js';

describe('vehicle response mapper', () => {
  const siteId = 'site-1';

  describe('toVehicleListResponse', () => {
    it('strips identity resolution state and redacts dealer fields outside authorized sites', () => {
      const response = toVehicleListResponse({
        rows: [
          {
            id: 'vehicle-1',
            inventory_role: 'USED',
            stock_status: 'RESERVED',
            location_id: 'lot-2',
            location: { id: 'lot-2', site_id: 'site-2' },
            reserved_for_customer_id: 'customer-2',
            reserved_for_customer: { id: 'customer-2' },
            identity_resolution_generation: 'generation-1',
            identity_resolution_token: 'token-1',
            customer: null,
          } as never,
        ],
        total: 1,
        page: 1,
        pageSize: 25,
        authorizedSiteIds: [siteId],
      });

      expect(response.data).toEqual([
        {
          id: 'vehicle-1',
          site_id: null,
          location_id: null,
          location: null,
          stock_status: null,
          inventory_role: null,
          reserved_for_customer_id: null,
          reserved_for_customer: null,
          customer: null,
        },
      ]);
      expect(response.meta).toEqual({ total: 1, page: 1, pageSize: 25, pageCount: 1 });
    });

    it('computes the page count from the total and page size', () => {
      expect(
        toVehicleListResponse({
          rows: [],
          total: 51,
          page: 2,
          pageSize: 25,
          authorizedSiteIds: [],
        }).meta,
      ).toEqual({ total: 51, page: 2, pageSize: 25, pageCount: 3 });
    });
  });

  describe('toVehicleDetailResponse', () => {
    it('omits Kaufvertrag archive internals from nested sales and attaches the Pickerl due state', () => {
      const response = toVehicleDetailResponse(
        {
          id: 'vehicle-1',
          first_registration_date: null,
          customer: null,
          identity_resolution_generation: 'generation-1',
          identity_resolution_token: 'token-1',
          inspection_records: [],
          sales: [
            {
              id: 'sale-1',
              kaufvertrag_snapshot: { seller: { name: 'Demo Autohaus GmbH' } },
              kaufvertrag_snapshot_sha256: 'a'.repeat(64),
              kaufvertrag_archive_bucket: 'pdf-archive-bucket',
              kaufvertrag_archive_key: 'archive/sale-1.pdf',
              kaufvertrag_archive_generation: '101',
              kaufvertrag_archive_sha256: 'b'.repeat(64),
              kaufvertrag_generated_at: new Date('2026-10-09T10:00:00.000Z'),
              kaufvertrag_generation_error: null,
            },
          ],
        } as never,
        [siteId],
        new Date('2026-10-13T12:00:00.000Z'),
      );

      expect(response).not.toHaveProperty('identity_resolution_generation');
      expect(response).not.toHaveProperty('identity_resolution_token');
      expect(response.sales).toEqual([
        {
          id: 'sale-1',
          kaufvertrag_generated_at: new Date('2026-10-09T10:00:00.000Z'),
          kaufvertrag_generation_error: null,
          gewaehrleistung_status: null,
          gewaehrleistung_ends_on_expired: false,
          presumption_ends_on_expired: false,
        },
      ]);
      expect(response.pickerl_due).toMatchObject({
        status: 'UNKNOWN',
        due_month: null,
        last_inspected_on: null,
      });
    });

    it('attaches the Gewährleistung status and expired flags to nested sales on the Vienna day', () => {
      const response = toVehicleDetailResponse(
        {
          id: 'vehicle-1',
          first_registration_date: null,
          customer: null,
          inspection_records: [],
          sales: [
            {
              id: 'sale-1',
              gewaehrleistung_ends_on: new Date('2026-10-14T00:00:00.000Z'),
              presumption_ends_on: new Date('2026-10-14T00:00:00.000Z'),
            },
          ],
        } as never,
        [siteId],
        // 22:30 UTC on 14 Oct is already 00:30 on 15 Oct in Vienna.
        new Date('2026-10-14T22:30:00.000Z'),
      );

      expect(response.sales[0]).toMatchObject({
        gewaehrleistung_status: 'EXPIRED',
        gewaehrleistung_ends_on_expired: true,
        presumption_ends_on_expired: true,
      });
    });

    it('maps the active parties and open service-due notices to day strings', () => {
      const response = toVehicleDetailResponse(
        {
          id: 'vehicle-1',
          first_registration_date: null,
          customer: null,
          inspection_records: [],
          sales: [],
          parties: [
            {
              id: 'party-1',
              vehicle_id: 'vehicle-1',
              customer_id: 'cust-1',
              role: 'OWNER',
              valid_from: new Date('2024-01-01T00:00:00.000Z'),
              valid_to: null,
              source: 'LEGACY_IMPORT',
              notes: null,
              createdAt: new Date('2026-10-13T00:00:00.000Z'),
              updatedAt: new Date('2026-10-13T00:00:00.000Z'),
              customer: {
                id: 'cust-1',
                type: 'PRIVATE',
                company_name: null,
                first_name: 'Anna',
                last_name: 'Synthetic',
              },
            },
          ],
          notices: [
            {
              id: 'notice-1',
              title: 'Service',
              body: null,
              due_date: new Date('2027-01-15T00:00:00.000Z'),
              due_mileage: 60000,
              external_ref: 'SERVICE-001',
              source: 'LEGACY_IMPORT',
            },
          ],
        } as never,
        [siteId],
        new Date('2026-10-13T12:00:00.000Z'),
      );

      expect(response.parties).toEqual([
        expect.objectContaining({
          id: 'party-1',
          role: 'OWNER',
          valid_from: '2024-01-01',
          valid_to: null,
          is_active: true,
          customer: expect.objectContaining({ first_name: 'Anna' }),
        }),
      ]);
      expect(response.open_due_dates).toEqual([
        {
          id: 'notice-1',
          title: 'Service',
          due_date: '2027-01-15',
          due_mileage: 60000,
          external_ref: 'SERVICE-001',
          source: 'LEGACY_IMPORT',
        },
      ]);
      expect(response).not.toHaveProperty('notices');
    });
  });
});
