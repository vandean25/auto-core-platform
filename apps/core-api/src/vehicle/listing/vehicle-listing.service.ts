import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleListingExportState,
  VehicleListingPlatform,
  VehicleListingVatDisplay,
  VehicleTaxScheme,
} from '@prisma/client';

import Decimal = Prisma.Decimal;
import { PrismaService } from '../../prisma/prisma.service.js';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../site/site-context.service.js';
import { resolveCurrentReceivedStockPurchaseId } from '../equipment/vehicle-equipment-stock-cycle.js';
import { getEquipmentPortalProfileConfig } from '../equipment/vehicle-equipment-portal-map.registry.js';
import type { EquipmentListingSerializerProfile } from '../equipment/vehicle-equipment-portal-map.types.js';
import {
  type CreateVehicleListingDto,
  type PatchVehicleListingChannelDto,
  type PatchVehicleListingDto,
  type VehicleListingDto,
} from './dto/vehicle-listing.dto.js';
import {
  computeListingContentSha256FromDb,
  photoMediaIdsForListing,
} from './vehicle-listing-content-hash.builder.js';
import { generateVehicleListingRef } from './vehicle-listing-ref.js';
import { VEHICLE_LISTING_PLATFORM_DEFAULTS } from './vehicle-listing-platform.defaults.js';
import { assertListingChannelActiveReadiness } from './vehicle-listing-readiness.js';
import { toVehicleListingDto } from './vehicle-listing.mapper.js';

const listingInclude = {
  photos: { include: { media: true }, orderBy: { sort_order: 'asc' } },
  channels: true,
} satisfies Prisma.VehicleListingInclude;

@Injectable()
export class VehicleListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async getListing(vehicleId: string): Promise<VehicleListingDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.assertUsedStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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
    return toVehicleListingDto(listing);
  }

  async createListing(
    vehicleId: string,
    dto: CreateVehicleListingDto,
  ): Promise<VehicleListingDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.assertUsedStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
    const stockPurchaseId = await resolveCurrentReceivedStockPurchaseId(
      this.prisma,
      tenantId,
      vehicleId,
      siteId,
    );

    if (dto.expected_stock_purchase_id !== stockPurchaseId) {
      throw new ConflictException({
        code: 'VEHICLE_LISTING_STOCK_CYCLE_MISMATCH',
        message: 'Listing stock purchase does not match the current cycle.',
      });
    }

    const existing = await this.prisma.vehicleListing.findFirst({
      where: {
        tenant_id: tenantId,
        id: dto.id,
      },
      include: listingInclude,
    });
    if (existing) {
      if (
        existing.vehicle_id !== vehicleId ||
        existing.stock_purchase_id !== stockPurchaseId
      ) {
        throw new ConflictException({
          code: 'VEHICLE_LISTING_ID_CONFLICT',
          message: 'Listing id is already used for a different stock cycle.',
        });
      }
      if (existing.site_id !== siteId) {
        throw new NotFoundException({
          code: 'VEHICLE_LISTING_NOT_FOUND',
          message: 'No marketplace listing exists for this stock cycle.',
        });
      }
      return toVehicleListingDto(existing);
    }

    const listingRef = generateVehicleListingRef();

    const created = await this.prisma.$transaction(async (tx) => {
      const contentSha256 = await computeListingContentSha256FromDb(tx, {
        tenantId,
        siteId,
        vehicleId,
        stockPurchaseId,
        listingRef,
        listing: null,
        photoMediaIds: [],
        channels: VEHICLE_LISTING_PLATFORM_DEFAULTS.map((row) => ({
          platform: row.platform,
          serializer_profile: row.serializer_profile,
          mapping_version: row.mapping_version,
        })),
      });

      const row = await tx.vehicleListing.create({
        data: {
          id: dto.id,
          tenant_id: tenantId,
          site_id: siteId,
          vehicle_id: vehicleId,
          stock_purchase_id: stockPurchaseId,
          listing_ref: listingRef,
          content_sha256: contentSha256,
          channels: {
            create: VEHICLE_LISTING_PLATFORM_DEFAULTS.map((defaults) => ({
              platform: defaults.platform,
              serializer_profile: defaults.serializer_profile,
              mapping_version: defaults.mapping_version,
            })),
          },
        },
        include: listingInclude,
      });
      return row;
    });

    return toVehicleListingDto(created);
  }

  async patchListing(
    vehicleId: string,
    dto: PatchVehicleListingDto,
  ): Promise<VehicleListingDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await this.assertUsedStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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

    const photoIds = dto.photo_ids;
    if (photoIds) {
      await this.validateListingPhotoIds(tenantId, siteId, vehicleId, photoIds);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const current = await tx.vehicleListing.findFirst({
        where: {
          tenant_id: tenantId,
          vehicle_id: vehicleId,
          stock_purchase_id: stockPurchaseId,
          site_id: siteId,
        },
        include: listingInclude,
      });
      if (!current) {
        throw new NotFoundException({
          code: 'VEHICLE_LISTING_NOT_FOUND',
          message: 'No marketplace listing exists for this stock cycle.',
        });
      }

      if (photoIds) {
        await tx.vehicleListingPhoto.deleteMany({
          where: { tenant_id: tenantId, listing_id: current.id },
        });
        if (photoIds.length > 0) {
          await tx.vehicleListingPhoto.createMany({
            data: photoIds.map((mediaId, index) => ({
              tenant_id: tenantId,
              listing_id: current.id,
              media_id: mediaId,
              sort_order: index,
            })),
          });
        }
      }

      const merged = {
        ...current,
        title: dto.title !== undefined ? dto.title : current.title,
        description:
          dto.description !== undefined ? dto.description : current.description,
        description_language:
          dto.description_language ?? current.description_language,
        price_gross_eur:
          dto.price_gross_eur !== undefined
            ? new Decimal(dto.price_gross_eur)
            : current.price_gross_eur,
        vat_display: dto.vat_display ?? current.vat_display,
        nova_included_confirmed:
          dto.nova_included_confirmed ?? current.nova_included_confirmed,
        mandatory_fees_included_confirmed:
          dto.mandatory_fees_included_confirmed ??
          current.mandatory_fees_included_confirmed,
        equipment_free_text:
          dto.equipment_free_text !== undefined
            ? dto.equipment_free_text
            : current.equipment_free_text,
        portal_category:
          dto.portal_category !== undefined
            ? dto.portal_category
            : current.portal_category,
        export_assertion_damage_free:
          dto.export_assertion_damage_free !== undefined
            ? dto.export_assertion_damage_free
            : current.export_assertion_damage_free,
        export_assertion_metallic:
          dto.export_assertion_metallic !== undefined
            ? dto.export_assertion_metallic
            : current.export_assertion_metallic,
        export_assertion_guarantee:
          dto.export_assertion_guarantee !== undefined
            ? dto.export_assertion_guarantee
            : current.export_assertion_guarantee,
        export_assertion_jahreswagen:
          dto.export_assertion_jahreswagen !== undefined
            ? dto.export_assertion_jahreswagen
            : current.export_assertion_jahreswagen,
        export_assertion_recommendation:
          dto.export_assertion_recommendation !== undefined
            ? dto.export_assertion_recommendation
            : current.export_assertion_recommendation,
        export_assertion_demo_vehicle:
          dto.export_assertion_demo_vehicle !== undefined
            ? dto.export_assertion_demo_vehicle
            : current.export_assertion_demo_vehicle,
      };

      const nextPhotoIds = photoIds ?? photoMediaIdsForListing(current);

      const contentSha256 = await computeListingContentSha256FromDb(tx, {
        tenantId,
        siteId,
        vehicleId,
        stockPurchaseId,
        listingRef: current.listing_ref,
        listing: merged,
        photoMediaIds: nextPhotoIds,
        channels: current.channels,
      });

      const hashChanged = contentSha256 !== current.content_sha256;

      const patchData: Prisma.VehicleListingUpdateManyMutationInput = {
        revision: { increment: 1 },
        content_sha256: contentSha256,
      };
      if (dto.title !== undefined) {
        patchData.title = dto.title;
      }
      if (dto.description !== undefined) {
        patchData.description = dto.description;
      }
      if (dto.description_language !== undefined) {
        patchData.description_language = dto.description_language;
      }
      if (dto.price_gross_eur !== undefined) {
        patchData.price_gross_eur = new Decimal(dto.price_gross_eur);
      }
      if (dto.vat_display !== undefined) {
        patchData.vat_display = dto.vat_display;
      }
      if (dto.nova_included_confirmed !== undefined) {
        patchData.nova_included_confirmed = dto.nova_included_confirmed;
      }
      if (dto.mandatory_fees_included_confirmed !== undefined) {
        patchData.mandatory_fees_included_confirmed =
          dto.mandatory_fees_included_confirmed;
      }
      if (dto.equipment_free_text !== undefined) {
        patchData.equipment_free_text = dto.equipment_free_text;
      }
      if (dto.portal_category !== undefined) {
        patchData.portal_category = dto.portal_category;
      }
      if (dto.export_assertion_damage_free !== undefined) {
        patchData.export_assertion_damage_free = dto.export_assertion_damage_free;
      }
      if (dto.export_assertion_metallic !== undefined) {
        patchData.export_assertion_metallic = dto.export_assertion_metallic;
      }
      if (dto.export_assertion_guarantee !== undefined) {
        patchData.export_assertion_guarantee = dto.export_assertion_guarantee;
      }
      if (dto.export_assertion_jahreswagen !== undefined) {
        patchData.export_assertion_jahreswagen = dto.export_assertion_jahreswagen;
      }
      if (dto.export_assertion_recommendation !== undefined) {
        patchData.export_assertion_recommendation =
          dto.export_assertion_recommendation;
      }
      if (dto.export_assertion_demo_vehicle !== undefined) {
        patchData.export_assertion_demo_vehicle = dto.export_assertion_demo_vehicle;
      }

      const guarded = await tx.vehicleListing.updateMany({
        where: {
          tenant_id: tenantId,
          id: current.id,
          revision: dto.expected_revision,
        },
        data: patchData,
      });
      if (guarded.count !== 1) {
        throw new ConflictException({
          code: 'VEHICLE_LISTING_REVISION_CONFLICT',
          message: 'Listing was modified by another request.',
        });
      }

      if (
        hashChanged &&
        current.channels.some(
          (channel) =>
            channel.export_state === VehicleListingExportState.FILE_GENERATED,
        )
      ) {
        await tx.vehicleListingChannel.updateMany({
          where: {
            tenant_id: tenantId,
            listing_id: current.id,
            export_state: VehicleListingExportState.FILE_GENERATED,
          },
          data: { export_state: VehicleListingExportState.DIRTY },
        });
      }

      const row = await tx.vehicleListing.findFirst({
        where: { tenant_id: tenantId, id: current.id },
        include: listingInclude,
      });
      if (!row) {
        throw new NotFoundException({
          code: 'VEHICLE_LISTING_NOT_FOUND',
          message: 'No marketplace listing exists for this stock cycle.',
        });
      }
      return row;
    });

    return toVehicleListingDto(updated);
  }

  async patchChannel(
    vehicleId: string,
    platformParam: string,
    dto: PatchVehicleListingChannelDto,
  ): Promise<VehicleListingDto> {
    const platform = this.parsePlatform(platformParam);
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    const vehicle = await this.assertUsedStockVehicleAtActiveSite(
      tenantId,
      vehicleId,
      siteId,
    );
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

    const channel = listing.channels.find((row) => row.platform === platform);
    if (!channel) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_CHANNEL_NOT_FOUND',
        message: `No channel exists for platform ${platform}.`,
      });
    }

    const serializerProfile =
      dto.serializer_profile ?? channel.serializer_profile;
    this.assertProfileAllowedForPlatform(platform, serializerProfile);

    const mergedListing = {
      price_gross_eur: listing.price_gross_eur,
      vat_display: listing.vat_display,
      nova_included_confirmed: listing.nova_included_confirmed,
      mandatory_fees_included_confirmed:
        listing.mandatory_fees_included_confirmed,
    };
    assertListingChannelActiveReadiness(
      dto.desired_state,
      mergedListing,
      vehicle,
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.vehicleListingChannel.update({
        where: { tenant_id: tenantId, id: channel.id },
        data: {
          desired_state: dto.desired_state,
          serializer_profile: serializerProfile,
          export_state:
            channel.export_state === VehicleListingExportState.FILE_GENERATED
              ? VehicleListingExportState.DIRTY
              : channel.export_state,
        },
      });

      const guarded = await tx.vehicleListing.updateMany({
        where: {
          tenant_id: tenantId,
          id: listing.id,
          revision: dto.expected_revision,
        },
        data: { revision: { increment: 1 } },
      });
      if (guarded.count !== 1) {
        throw new ConflictException({
          code: 'VEHICLE_LISTING_REVISION_CONFLICT',
          message: 'Listing was modified by another request.',
        });
      }

      const row = await tx.vehicleListing.findFirst({
        where: { tenant_id: tenantId, id: listing.id },
        include: listingInclude,
      });
      if (!row) {
        throw new NotFoundException({
          code: 'VEHICLE_LISTING_NOT_FOUND',
          message: 'No marketplace listing exists for this stock cycle.',
        });
      }
      return row;
    });

    return toVehicleListingDto(updated);
  }

  private parsePlatform(value: string): VehicleListingPlatform {
    const normalized = value.trim().toUpperCase().replaceAll('-', '_');
    if (
      !Object.values(VehicleListingPlatform).includes(
        normalized as VehicleListingPlatform,
      )
    ) {
      throw new BadRequestException({
        code: 'VEHICLE_LISTING_PLATFORM_INVALID',
        message: `Unknown listing platform ${value}.`,
      });
    }
    return normalized as VehicleListingPlatform;
  }

  private assertProfileAllowedForPlatform(
    platform: VehicleListingPlatform,
    profile: string,
  ): void {
    getEquipmentPortalProfileConfig(
      profile as EquipmentListingSerializerProfile,
    );
    const defaults = VEHICLE_LISTING_PLATFORM_DEFAULTS.find(
      (row) => row.platform === platform,
    );
    if (!defaults) {
      throw new BadRequestException({
        code: 'VEHICLE_LISTING_PLATFORM_INVALID',
        message: `Unknown listing platform ${platform}.`,
      });
    }
    if (defaults.serializer_profile !== profile) {
      throw new BadRequestException({
        code: 'VEHICLE_LISTING_SERIALIZER_PROFILE_INVALID',
        message: `Profile ${profile} is not registered for platform ${platform}.`,
      });
    }
  }

  private async validateListingPhotoIds(
    tenantId: string,
    siteId: string,
    vehicleId: string,
    mediaIds: string[],
  ): Promise<void> {
    if (mediaIds.length === 0) {
      return;
    }
    const rows = await this.prisma.vehicleMedia.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
        id: { in: mediaIds },
      },
      select: { id: true },
    });
    if (rows.length !== mediaIds.length) {
      throw new BadRequestException({
        code: 'VEHICLE_LISTING_PHOTO_INVALID',
        message:
          'One or more listing photos are unknown for this vehicle at the active site.',
      });
    }
  }

  private async assertUsedStockVehicleAtActiveSite(
    tenantId: string,
    vehicleId: string,
    siteId: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        inventory_role: VehicleInventoryRole.USED,
        location: { site_id: siteId },
      },
      select: {
        id: true,
        tax_scheme: true,
        inventory_role: true,
        stock_status: true,
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
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return vehicle;
  }

  static mapVehicleTaxSchemeToVatDisplay(
    scheme: VehicleTaxScheme | null | undefined,
  ): VehicleListingVatDisplay | null {
    if (scheme === VehicleTaxScheme.MARGIN) {
      return VehicleListingVatDisplay.MARGIN;
    }
    if (scheme === VehicleTaxScheme.STANDARD) {
      return VehicleListingVatDisplay.STANDARD;
    }
    return null;
  }
}
