import {
  VehicleListingDesiredState,
  VehicleListingExportState,
  VehicleListingPlatform,
  VehicleListingRemoteState,
} from '@prisma/client';
import { toMcpVehicleListingStatus } from './mcp-listing-read.mapper.js';

describe('toMcpVehicleListingStatus', () => {
  it('maps per-portal channel status fields', () => {
    const exportedAt = new Date('2026-10-01T12:00:00.000Z');
    const result = toMcpVehicleListingStatus('vehicle-1', {
      id: 'listing-1',
      listing_ref: 'Labc',
      stock_purchase_id: 'purchase-1',
      revision: 2,
      channels: [
        {
          platform: VehicleListingPlatform.MOBILE_DE,
          desired_state: VehicleListingDesiredState.INACTIVE,
          export_state: VehicleListingExportState.REMOVAL_REQUIRED,
          remote_state: VehicleListingRemoteState.UNKNOWN,
          serializer_profile: 'MOBILE_DE_REFERENCE_V1',
          last_export_at: exportedAt,
          removal_revision: 1,
        } as never,
      ],
    } as never);

    expect(result).toEqual({
      vehicle_id: 'vehicle-1',
      listing_id: 'listing-1',
      listing_ref: 'Labc',
      stock_purchase_id: 'purchase-1',
      revision: 2,
      channels: [
        {
          platform: 'MOBILE_DE',
          desired_state: 'INACTIVE',
          export_state: 'REMOVAL_REQUIRED',
          remote_state: 'UNKNOWN',
          serializer_profile: 'MOBILE_DE_REFERENCE_V1',
          last_export_at: exportedAt.toISOString(),
          removal_revision: 1,
        },
      ],
    });
  });
});
