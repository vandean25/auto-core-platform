import { VehicleListingExportState } from '@prisma/client';
import { applyListingContentHashUpdate } from './vehicle-listing-hash-sync.js';

describe('applyListingContentHashUpdate', () => {
  it('skips channel dirtying when revision guard does not match', async () => {
    const vehicleListing = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const vehicleListingChannel = {
      updateMany: jest.fn(),
    };
    const prisma = {
      vehicle: {
        findFirst: jest.fn().mockResolvedValue({
          make: 'VW',
          model: 'Golf',
          year: 2020,
          mileage: 10000,
          fuel_type: 'PETROL',
          power_kw: 85,
          first_registration_date: new Date('2020-03-15'),
          co2_wltp_g_km: 120,
          co2_nedc_g_km: null,
          color: 'Black',
          emission_class: 'EURO6',
        }),
      },
      vehicleEquipmentSelection: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      vehicleEquipmentFreeTextItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      vehicleMedia: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      vehicleListing,
      vehicleListingChannel,
    };

    const listing = {
      id: 'listing-1',
      tenant_id: 'tenant-1',
      site_id: 'site-1',
      vehicle_id: 'vehicle-1',
      stock_purchase_id: 'purchase-1',
      listing_ref: 'Labc123',
      revision: 3,
      content_sha256: 'a'.repeat(64),
      title: null,
      description: 'Exported description text.',
      description_language: 'DE',
      price_gross_eur: null,
      vat_display: null,
      nova_included_confirmed: false,
      mandatory_fees_included_confirmed: false,
      equipment_free_text: null,
      photos: [],
      channels: [
        {
          platform: 'MOBILE_DE',
          serializer_profile: 'MOBILE_DE_REFERENCE_V1',
          mapping_version: '1',
          export_state: VehicleListingExportState.FILE_GENERATED,
        },
      ],
    };

    const changed = await applyListingContentHashUpdate(
      prisma as never,
      listing as never,
    );

    expect(changed).toBe(false);
    expect(vehicleListing.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ revision: 3 }),
      }),
    );
    expect(vehicleListingChannel.updateMany).not.toHaveBeenCalled();
  });
});
