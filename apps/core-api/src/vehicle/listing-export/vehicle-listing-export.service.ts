import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VehicleListingDesiredState,
  VehicleListingExportState,
  VehicleListingPlatform,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { resolveCurrentReceivedStockPurchaseId } from '../equipment/vehicle-equipment-stock-cycle.js';
import type { EquipmentListingSerializerProfile } from '../equipment/vehicle-equipment-portal-map.types.js';
import { assertListingChannelActiveReadiness } from '../listing/vehicle-listing-readiness.js';
import {
  VEHICLE_MEDIA_STORAGE,
  type VehicleMediaStorage,
} from '../../vehicle-stock/vehicle-media/vehicle-media.storage.js';
import type { VehicleMediaVariantMap } from '../../vehicle-stock/vehicle-media/vehicle-media.types.js';
import { buildListingSerializerInput } from './listing-export-snapshot.builder.js';
import { resolveListingSerializer } from './listing-serializer.registry.js';

const listingInclude = {
  photos: { include: { media: true }, orderBy: { sort_order: 'asc' } },
  channels: true,
} as const;

function resolvePortalImageStorageKey(media: {
  processed_storage_key: string;
  variant_storage_keys: unknown;
}): string {
  const variants = media.variant_storage_keys as VehicleMediaVariantMap;
  return variants?.portal_md?.storage_key ?? media.processed_storage_key;
}

@Injectable()
export class VehicleListingExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(VEHICLE_MEDIA_STORAGE)
    private readonly mediaStorage: VehicleMediaStorage,
  ) {}

  async downloadListingPackage(
    vehicleId: string,
    profileCode: string,
  ): Promise<{
    filename: string;
    bytes: Buffer;
    sha256: string;
    byteLength: number;
  }> {
    const serializer = resolveListingSerializer(profileCode);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();

    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        inventory_role: 'USED',
        location: { site_id: siteId },
      },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        mileage: true,
        fuel_type: true,
        power_kw: true,
        first_registration_date: true,
        co2_wltp_g_km: true,
        co2_nedc_g_km: true,
        color: true,
        emission_class: true,
        inventory_role: true,
        stock_status: true,
        tax_scheme: true,
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }

    const stockPurchaseId = await resolveCurrentReceivedStockPurchaseId(
      this.prisma,
      tenantId,
      vehicleId,
      siteId,
    );

    const listing = await this.prisma.vehicleListing.findFirst({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        stock_purchase_id: stockPurchaseId,
        site_id: siteId,
      },
      include: listingInclude,
    });
    if (!listing) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_NOT_FOUND',
        message: 'No marketplace listing exists for this stock cycle.',
      });
    }

    const channel = listing.channels.find(
      (row) => row.platform === serializer.platform,
    );
    if (!channel) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_CHANNEL_NOT_FOUND',
        message: `No listing channel exists for ${serializer.platform}.`,
      });
    }
    if (channel.serializer_profile !== serializer.profileCode) {
      throw new UnprocessableEntityException({
        code: 'LISTING_SERIALIZER_PROFILE_MISMATCH',
        message: `Channel profile ${channel.serializer_profile} does not match ${serializer.profileCode}.`,
      });
    }
    if (channel.desired_state !== VehicleListingDesiredState.ACTIVE) {
      throw new UnprocessableEntityException({
        code: 'VEHICLE_LISTING_NOT_READY',
        message:
          'Listing channel must be ACTIVE before downloading an export package.',
      });
    }

    assertListingChannelActiveReadiness(
      VehicleListingDesiredState.ACTIVE,
      {
        price_gross_eur: listing.price_gross_eur,
        vat_display: listing.vat_display,
        nova_included_confirmed: listing.nova_included_confirmed,
        mandatory_fees_included_confirmed:
          listing.mandatory_fees_included_confirmed,
      },
      vehicle,
    );

    const generatedAt = new Date();
    const imageBytesByMediaId = new Map<string, Buffer>();
    const bucket = this.mediaStorage.resolveBucket();
    for (const photo of listing.photos) {
      const key = resolvePortalImageStorageKey(photo.media);
      const bytes = await this.mediaStorage.readObject({ bucket, key });
      imageBytesByMediaId.set(photo.media_id, bytes);
    }

    const [selections, freeTextItems] = await Promise.all([
      this.prisma.vehicleEquipmentSelection.findMany({
        where: {
          tenant_id: tenantId,
          stock_purchase_id: stockPurchaseId,
        },
        include: { option: true },
      }),
      this.prisma.vehicleEquipmentFreeTextItem.findMany({
        where: {
          tenant_id: tenantId,
          stock_purchase_id: stockPurchaseId,
        },
        orderBy: { sort_order: 'asc' },
      }),
    ]);

    const snapshot = buildListingSerializerInput({
      profileCode: serializer.profileCode as EquipmentListingSerializerProfile,
      mappingVersion: channel.mapping_version,
      generatedAt,
      listing,
      vehicle,
      equipmentSelections: selections.map((row) => ({
        code: row.option.code,
        label_de: row.option.label_de,
        label_en: row.option.label_en,
        assertion: row.assertion,
      })),
      equipmentFreeTextLines: freeTextItems.map((row) => row.text),
      imageBytesByMediaId,
    });

    const issues = serializer.validate(snapshot);
    if (issues.length > 0) {
      throw new UnprocessableEntityException({
        code: 'LISTING_EXPORT_VALIDATION_FAILED',
        message: 'Listing export validation failed.',
        issues,
      });
    }

    const result = serializer.serialize(snapshot);
    if (result.byteLength > serializer.limits.maxZipBytes) {
      throw new UnprocessableEntityException({
        code: 'LISTING_EXPORT_TOO_LARGE',
        message: 'Listing export package exceeds the allowed size.',
      });
    }

    await this.prisma.vehicleListingChannel.update({
      where: { tenant_id: tenantId, id: channel.id },
      data: {
        export_state: VehicleListingExportState.FILE_GENERATED,
        last_export_at: generatedAt,
        last_export_content_sha256: listing.content_sha256,
      },
    });

    return {
      filename: serializer.buildZipFilename({
        listingRef: listing.listing_ref,
        generatedAt,
      }),
      bytes: result.zipBytes,
      sha256: result.sha256,
      byteLength: result.byteLength,
    };
  }
}
