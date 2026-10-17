import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
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
  computeVehicleListingContentSha256,
  type VehicleListingContentHashInput,
} from './vehicle-listing-content-hash.js';
import { generateVehicleListingRef } from './vehicle-listing-ref.js';
import { VEHICLE_LISTING_PLATFORM_DEFAULTS } from './vehicle-listing-platform.defaults.js';
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
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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
      return toVehicleListingDto(existing);
    }

    const listingRef = generateVehicleListingRef();
    const contentSha256 = computeVehicleListingContentSha256(
      await this.buildHashInput({
        tenantId,
        listingRef,
        vehicleId,
        stockPurchaseId,
        listing: null,
        photoMediaIds: [],
        channels: VEHICLE_LISTING_PLATFORM_DEFAULTS.map((row) => ({
          platform: row.platform,
          serializer_profile: row.serializer_profile,
          mapping_version: row.mapping_version,
        })),
      }),
    );

    const created = await this.prisma.$transaction(async (tx) => {
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
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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
    if (listing.revision !== dto.expected_revision) {
      throw new ConflictException({
        code: 'VEHICLE_LISTING_REVISION_CONFLICT',
        message: 'Listing was modified by another request.',
      });
    }

    const photoIds = dto.photo_ids;
    if (photoIds) {
      await this.validateListingPhotoIds(tenantId, vehicleId, photoIds);
    }

    const nextData: Prisma.VehicleListingUpdateInput = {
      revision: { increment: 1 },
    };

    if (dto.title !== undefined) {
      nextData.title = dto.title;
    }
    if (dto.description !== undefined) {
      nextData.description = dto.description;
    }
    if (dto.description_language !== undefined) {
      nextData.description_language = dto.description_language;
    }
    if (dto.price_gross_eur !== undefined) {
      nextData.price_gross_eur = new Decimal(dto.price_gross_eur);
    }
    if (dto.vat_display !== undefined) {
      nextData.vat_display = dto.vat_display;
    }
    if (dto.nova_included_confirmed !== undefined) {
      nextData.nova_included_confirmed = dto.nova_included_confirmed;
    }
    if (dto.mandatory_fees_included_confirmed !== undefined) {
      nextData.mandatory_fees_included_confirmed =
        dto.mandatory_fees_included_confirmed;
    }
    if (dto.equipment_free_text !== undefined) {
      nextData.equipment_free_text = dto.equipment_free_text;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (photoIds) {
        await tx.vehicleListingPhoto.deleteMany({
          where: { tenant_id: tenantId, listing_id: listing.id },
        });
        if (photoIds.length > 0) {
          await tx.vehicleListingPhoto.createMany({
            data: photoIds.map((mediaId, index) => ({
              tenant_id: tenantId,
              listing_id: listing.id,
              media_id: mediaId,
              sort_order: index,
            })),
          });
        }
      }

      const dirtyChannels =
        listing.channels.some(
          (channel) =>
            channel.export_state === VehicleListingExportState.FILE_GENERATED,
        ) || photoIds !== undefined;

      if (dirtyChannels) {
        await tx.vehicleListingChannel.updateMany({
          where: {
            tenant_id: tenantId,
            listing_id: listing.id,
            export_state: VehicleListingExportState.FILE_GENERATED,
          },
          data: { export_state: VehicleListingExportState.DIRTY },
        });
      }

      const merged = {
        ...listing,
        title: dto.title !== undefined ? dto.title : listing.title,
        description:
          dto.description !== undefined ? dto.description : listing.description,
        description_language:
          dto.description_language ?? listing.description_language,
        price_gross_eur:
          dto.price_gross_eur !== undefined
            ? new Decimal(dto.price_gross_eur)
            : listing.price_gross_eur,
        vat_display: dto.vat_display ?? listing.vat_display,
        nova_included_confirmed:
          dto.nova_included_confirmed ?? listing.nova_included_confirmed,
        mandatory_fees_included_confirmed:
          dto.mandatory_fees_included_confirmed ??
          listing.mandatory_fees_included_confirmed,
        equipment_free_text:
          dto.equipment_free_text !== undefined
            ? dto.equipment_free_text
            : listing.equipment_free_text,
      };

      const contentSha256 = computeVehicleListingContentSha256(
        await this.buildHashInput({
          tenantId,
          listingRef: listing.listing_ref,
          vehicleId,
          stockPurchaseId,
          listing: merged,
          photoMediaIds: photoIds ?? listing.photos.map((row) => row.media_id),
          channels: listing.channels.map((channel) => ({
            platform: channel.platform,
            serializer_profile: channel.serializer_profile,
            mapping_version: channel.mapping_version,
          })),
        }),
      );

      return tx.vehicleListing.update({
        where: { tenant_id: tenantId, id: listing.id },
        data: {
          ...nextData,
          content_sha256: contentSha256,
        },
        include: listingInclude,
      });
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
    await this.assertStockVehicleAtActiveSite(tenantId, vehicleId, siteId);
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
    if (listing.revision !== dto.expected_revision) {
      throw new ConflictException({
        code: 'VEHICLE_LISTING_REVISION_CONFLICT',
        message: 'Listing was modified by another request.',
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextChannels = listing.channels.map((row) =>
        row.platform === platform
          ? {
              ...row,
              desired_state: dto.desired_state,
              serializer_profile: serializerProfile,
            }
          : row,
      );

      const contentSha256 = computeVehicleListingContentSha256(
        await this.buildHashInput({
          tenantId,
          listingRef: listing.listing_ref,
          vehicleId,
          stockPurchaseId,
          listing,
          photoMediaIds: listing.photos.map((row) => row.media_id),
          channels: nextChannels.map((row) => ({
            platform: row.platform,
            serializer_profile: row.serializer_profile,
            mapping_version: row.mapping_version,
          })),
        }),
      );

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

      return tx.vehicleListing.update({
        where: { tenant_id: tenantId, id: listing.id },
        data: {
          revision: { increment: 1 },
          content_sha256: contentSha256,
        },
        include: listingInclude,
      });
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
    vehicleId: string,
    mediaIds: string[],
  ): Promise<void> {
    if (mediaIds.length === 0) {
      return;
    }
    const rows = await this.prisma.vehicleMedia.findMany({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        id: { in: mediaIds },
      },
      select: { id: true },
    });
    if (rows.length !== mediaIds.length) {
      throw new BadRequestException({
        code: 'VEHICLE_LISTING_PHOTO_INVALID',
        message: 'One or more listing photos are unknown for this vehicle.',
      });
    }
  }

  private formatPriceForHash(value: Decimal | null | undefined): string | null {
    if (!value) {
      return null;
    }
    return value.toFixed(2);
  }

  private async buildHashInput(params: {
    tenantId: string;
    listingRef: string;
    vehicleId: string;
    stockPurchaseId: string;
    listing: {
      title: string | null;
      description: string | null;
      description_language: string;
      price_gross_eur: Decimal | null;
      vat_display: VehicleListingVatDisplay | null;
      nova_included_confirmed: boolean;
      mandatory_fees_included_confirmed: boolean;
      equipment_free_text: string | null;
    } | null;
    photoMediaIds: string[];
    channels: {
      platform: string;
      serializer_profile: string;
      mapping_version: string;
    }[];
  }): Promise<VehicleListingContentHashInput> {
    const selections = await this.prisma.vehicleEquipmentSelection.findMany({
      where: {
        tenant_id: params.tenantId,
        stock_purchase_id: params.stockPurchaseId,
      },
      include: { option: true },
    });

    const mediaRows =
      params.photoMediaIds.length === 0
        ? []
        : await this.prisma.vehicleMedia.findMany({
            where: {
              tenant_id: params.tenantId,
              vehicle_id: params.vehicleId,
              id: { in: params.photoMediaIds },
            },
          });

    const mediaById = new Map(mediaRows.map((row) => [row.id, row]));
    const photos = params.photoMediaIds
      .map((mediaId, index) => {
        const media = mediaById.get(mediaId);
        if (!media) {
          return null;
        }
        return {
          media_id: mediaId,
          content_sha256: media.content_sha256,
          sort_order: index,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const listing = params.listing;

    return {
      listing_ref: params.listingRef,
      title: listing?.title ?? null,
      description: listing?.description ?? null,
      description_language: listing?.description_language ?? 'DE',
      price_gross_eur: this.formatPriceForHash(
        listing?.price_gross_eur ?? null,
      ),
      vat_display: listing?.vat_display ?? null,
      nova_included_confirmed: listing?.nova_included_confirmed ?? false,
      mandatory_fees_included_confirmed:
        listing?.mandatory_fees_included_confirmed ?? false,
      equipment_free_text: listing?.equipment_free_text ?? null,
      equipment: selections.map((row) => ({
        code: row.option.code,
        assertion: row.assertion,
      })),
      photos,
      channels: params.channels,
    };
  }

  private async assertStockVehicleAtActiveSite(
    tenantId: string,
    vehicleId: string,
    siteId: string,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        tenant_id: tenantId,
        location: { site_id: siteId },
      },
      select: { id: true, tax_scheme: true },
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
