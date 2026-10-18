import {
  BadGatewayException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  VehicleListingDmsProvider,
  VehicleListingDmsSyncState,
  VehicleListingPlatform,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { TenantContextService } from '../../../common/services/tenant-context.service.js';
import { SiteContextService } from '../../../site/site-context.service.js';
import { resolveCurrentReceivedStockPurchaseId } from '../../equipment/vehicle-equipment-stock-cycle.js';
import {
  AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT,
  type Autoscout24DmsListingPublisherPort,
} from './autoscout24-dms-api.port.js';
import { Autoscout24DmsAdapterError } from './autoscout24-dms-api.types.js';
import { assertVehicleListingAs24PushEnabled } from './autoscout24-dms-push-guard.js';

export type Autoscout24DmsPushAction = 'UPSERT' | 'DEACTIVATE';

export type Autoscout24DmsPushResultDto = {
  channel_id: string;
  provider: VehicleListingDmsProvider;
  sync_state: VehicleListingDmsSyncState;
  external_listing_id: string | null;
  last_sync_at: string | null;
  last_sync_error_code: string | null;
  idempotent_replay: boolean;
};

@Injectable()
export class Autoscout24DmsListingPushService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
    @Inject(AUTOSCOUT24_DMS_LISTING_PUBLISHER_PORT)
    private readonly publisher: Autoscout24DmsListingPublisherPort,
  ) {}

  async pushListing(
    vehicleId: string,
    input: {
      idempotency_key: string;
      expected_revision: number;
      action: Autoscout24DmsPushAction;
    },
  ): Promise<Autoscout24DmsPushResultDto> {
    const tenantId = await this.tenantContext.getTenantId();
    const siteId = await this.siteContext.getSiteId();
    await assertVehicleListingAs24PushEnabled(this.prisma, tenantId);

    const stockPurchaseId = await resolveCurrentReceivedStockPurchaseId(
      this.prisma,
      tenantId,
      siteId,
      vehicleId,
    );

    const listing = await this.prisma.vehicleListing.findFirst({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        stock_purchase_id: stockPurchaseId,
        site_id: siteId,
      },
      include: {
        channels: {
          where: { platform: VehicleListingPlatform.AS24 },
        },
      },
    });

    if (!listing) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_NOT_FOUND',
        message: 'No marketplace listing exists for this stock cycle.',
      });
    }

    if (listing.revision !== input.expected_revision) {
      throw new ConflictException({
        code: 'VEHICLE_LISTING_REVISION_CONFLICT',
        message: 'Listing revision does not match the expected value.',
      });
    }

    const channel = listing.channels[0];
    if (!channel) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_CHANNEL_NOT_FOUND',
        message: 'No AutoScout24 channel exists for this listing.',
      });
    }

    const existingSync =
      await this.prisma.vehicleListingChannelDmsSync.findUnique({
        where: {
          tenant_id_channel_id_provider: {
            tenant_id: tenantId,
            channel_id: channel.id,
            provider: VehicleListingDmsProvider.AS24_DMS,
          },
        },
      });

    if (
      existingSync?.last_idempotency_key === input.idempotency_key &&
      existingSync.sync_state === VehicleListingDmsSyncState.SYNCED &&
      input.action === 'UPSERT'
    ) {
      return this.toDto(existingSync, channel.id, true);
    }
    if (
      existingSync?.last_idempotency_key === input.idempotency_key &&
      existingSync.sync_state === VehicleListingDmsSyncState.DEACTIVATED &&
      input.action === 'DEACTIVATE'
    ) {
      return this.toDto(existingSync, channel.id, true);
    }

    const syncRow = await this.prisma.vehicleListingChannelDmsSync.upsert({
      where: {
        tenant_id_channel_id_provider: {
          tenant_id: tenantId,
          channel_id: channel.id,
          provider: VehicleListingDmsProvider.AS24_DMS,
        },
      },
      create: {
        tenant_id: tenantId,
        channel_id: channel.id,
        provider: VehicleListingDmsProvider.AS24_DMS,
        sync_state: VehicleListingDmsSyncState.PENDING,
        last_idempotency_key: input.idempotency_key,
      },
      update: {
        sync_state: VehicleListingDmsSyncState.PENDING,
        last_idempotency_key: input.idempotency_key,
      },
    });

    const payload = {
      sellerListingRef: listing.listing_ref,
      title: listing.title,
      priceGrossEur: listing.price_gross_eur?.toString() ?? null,
      action: input.action,
    };

    try {
      const now = new Date();
      if (input.action === 'DEACTIVATE') {
        const result = await this.publisher.deactivateListing(
          input.idempotency_key,
          payload,
          syncRow.external_listing_id ?? channel.external_ref,
        );
        const updated = await this.prisma.vehicleListingChannelDmsSync.update({
          where: { tenant_id: tenantId, id: syncRow.id },
          data: {
            sync_state: VehicleListingDmsSyncState.DEACTIVATED,
            last_sync_at: now,
            last_sync_error_code: null,
            external_listing_id:
              result.externalListingId ?? syncRow.external_listing_id,
            last_idempotency_key: input.idempotency_key,
          },
        });
        return this.toDto(updated, channel.id, result.idempotentReplay);
      }

      if (!listing.price_gross_eur || !listing.title) {
        throw new UnprocessableEntityException({
          code: 'VEHICLE_LISTING_NOT_READY',
          message:
            'Listing must have a title and gross price before AutoScout24 DMS push.',
        });
      }

      const result = await this.publisher.upsertListing(
        input.idempotency_key,
        { ...payload, action: 'UPSERT' },
        syncRow.external_listing_id ?? channel.external_ref,
      );

      const updated = await this.prisma.$transaction(async (tx) => {
        const sync = await tx.vehicleListingChannelDmsSync.update({
          where: { tenant_id: tenantId, id: syncRow.id },
          data: {
            sync_state: VehicleListingDmsSyncState.SYNCED,
            last_sync_at: now,
            last_sync_error_code: null,
            external_listing_id: result.externalListingId,
            last_idempotency_key: input.idempotency_key,
          },
        });
        await tx.vehicleListingChannel.updateMany({
          where: { tenant_id: tenantId, id: channel.id },
          data: { external_ref: result.externalListingId },
        });
        return sync;
      });

      return this.toDto(updated, channel.id, result.idempotentReplay);
    } catch (error) {
      const mapped = this.mapThrownError(error);
      await this.prisma.vehicleListingChannelDmsSync.update({
        where: { tenant_id: tenantId, id: syncRow.id },
        data: {
          sync_state: VehicleListingDmsSyncState.FAILED,
          last_sync_at: new Date(),
          last_sync_error_code: mapped.code,
          last_idempotency_key: input.idempotency_key,
        },
      });
      throw mapped.exception;
    }
  }

  private mapThrownError(error: unknown): {
    code: string;
    exception: Error;
  } {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      const code =
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof (response as { code: unknown }).code === 'string'
          ? (response as { code: string }).code
          : 'LISTING_PUSH_PROVIDER_ERROR';
      return { code, exception: error };
    }
    if (error instanceof Autoscout24DmsAdapterError) {
      if (error.code === 'timeout') {
        return {
          code: 'LISTING_PUSH_TIMEOUT',
          exception: new BadGatewayException({
            code: 'LISTING_PUSH_TIMEOUT',
            message: 'AutoScout24 DMS API request timed out.',
          }),
        };
      }
      if (error.code === 'client_error') {
        return {
          code: 'LISTING_PUSH_CLIENT_ERROR',
          exception: new UnprocessableEntityException({
            code: 'LISTING_PUSH_CLIENT_ERROR',
            message: 'AutoScout24 DMS API rejected the listing payload.',
          }),
        };
      }
      if (error.code === 'unconfigured') {
        return {
          code: 'LISTING_PUSH_UNCONFIGURED',
          exception: error,
        };
      }
      return {
        code: 'LISTING_PUSH_PROVIDER_ERROR',
        exception: new BadGatewayException({
          code: 'LISTING_PUSH_PROVIDER_ERROR',
          message: 'AutoScout24 DMS API is temporarily unavailable.',
        }),
      };
    }
    if (error instanceof Error) {
      return { code: 'LISTING_PUSH_PROVIDER_ERROR', exception: error };
    }
    return {
      code: 'LISTING_PUSH_PROVIDER_ERROR',
      exception: new BadGatewayException({
        code: 'LISTING_PUSH_PROVIDER_ERROR',
        message: 'AutoScout24 DMS API is temporarily unavailable.',
      }),
    };
  }

  private toDto(
    row: {
      id: string;
      provider: VehicleListingDmsProvider;
      sync_state: VehicleListingDmsSyncState;
      external_listing_id: string | null;
      last_sync_at: Date | null;
      last_sync_error_code: string | null;
    },
    channelId: string,
    idempotentReplay: boolean,
  ): Autoscout24DmsPushResultDto {
    return {
      channel_id: channelId,
      provider: row.provider,
      sync_state: row.sync_state,
      external_listing_id: row.external_listing_id,
      last_sync_at: row.last_sync_at?.toISOString() ?? null,
      last_sync_error_code: row.last_sync_error_code,
      idempotent_replay: idempotentReplay,
    };
  }
}
