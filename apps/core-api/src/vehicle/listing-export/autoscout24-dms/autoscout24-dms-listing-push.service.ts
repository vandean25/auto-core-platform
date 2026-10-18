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
  VehicleListingDesiredState,
  VehicleListingDmsProvider,
  VehicleListingDmsSyncState,
  VehicleListingPlatform,
  type VehicleListingChannelDmsSync,
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
import { digestAutoscout24DmsPushPayload } from './autoscout24-dms-payload-digest.js';
import { assertVehicleListingAs24PushEnabled } from './autoscout24-dms-push-guard.js';
import { isVehicleListingAs24PushEnvEnabled } from './autoscout24-dms-env.js';
import {
  ensureDmsSyncRow,
  lockVehicleListingChannelDmsSyncRow,
} from './autoscout24-dms-sync-lock.js';

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

type PushContext = {
  tenantId: string;
  channelId: string;
  listingRef: string;
  externalRef: string | null;
  payloadDigest: string;
  syncId: string;
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
    const loaded = await this.loadListingContext(vehicleId);
    if (loaded.listing.revision !== input.expected_revision) {
      throw new ConflictException({
        code: 'VEHICLE_LISTING_REVISION_CONFLICT',
        message: 'Listing revision does not match the expected value.',
      });
    }
    return this.executePush(loaded, input);
  }

  /**
   * After sale finalization: deactivate the remote listing when push flags are on.
   * No-op when push is disabled (no adapter or credential access).
   */
  async deactivateAfterVehicleSale(input: {
    tenantId: string;
    siteId: string;
    vehicleId: string;
    stockPurchaseId: string;
  }): Promise<void> {
    if (!isVehicleListingAs24PushEnvEnabled()) {
      return;
    }
    const settings = await this.prisma.vehicleListingPushSettings.findUnique({
      where: { tenant_id: input.tenantId },
      select: { as24_dms_push_enabled: true },
    });
    if (!settings?.as24_dms_push_enabled) {
      return;
    }

    const listing = await this.prisma.vehicleListing.findFirst({
      where: {
        tenant_id: input.tenantId,
        vehicle_id: input.vehicleId,
        stock_purchase_id: input.stockPurchaseId,
        site_id: input.siteId,
      },
      include: {
        channels: { where: { platform: VehicleListingPlatform.AS24 } },
      },
    });
    const channel = listing?.channels[0];
    if (!listing || !channel) {
      return;
    }

    const sync = await this.prisma.vehicleListingChannelDmsSync.findUnique({
      where: {
        tenant_id_channel_id_provider: {
          tenant_id: input.tenantId,
          channel_id: channel.id,
          provider: VehicleListingDmsProvider.AS24_DMS,
        },
      },
    });
    if (sync?.sync_state !== VehicleListingDmsSyncState.SYNCED) {
      return;
    }

    await this.executePush(
      {
        tenantId: input.tenantId,
        listing,
        channel,
      },
      {
        idempotency_key: `sale-deactivate:${input.stockPurchaseId}`,
        action: 'DEACTIVATE',
      },
    ).catch(() => undefined);
  }

  private async loadListingContext(vehicleId: string) {
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

    const channel = listing.channels[0];
    if (!channel) {
      throw new NotFoundException({
        code: 'VEHICLE_LISTING_CHANNEL_NOT_FOUND',
        message: 'No AutoScout24 channel exists for this listing.',
      });
    }

    return { tenantId, listing, channel };
  }

  private async executePush(
    loaded: {
      tenantId: string;
      listing: {
        id: string;
        listing_ref: string;
        title: string | null;
        price_gross_eur: { toString(): string } | null;
      };
      channel: {
        id: string;
        external_ref: string | null;
        desired_state: VehicleListingDesiredState;
      };
    },
    input: {
      idempotency_key: string;
      action: Autoscout24DmsPushAction;
    },
  ): Promise<Autoscout24DmsPushResultDto> {
    const { tenantId, listing, channel } = loaded;

    if (
      input.action === 'UPSERT' &&
      channel.desired_state !== VehicleListingDesiredState.ACTIVE
    ) {
      throw new UnprocessableEntityException({
        code: 'VEHICLE_LISTING_NOT_READY',
        message:
          'AutoScout24 DMS push requires an ACTIVE channel; withdraw or complete sale handling first.',
      });
    }

    const payload = {
      sellerListingRef: listing.listing_ref,
      title: listing.title,
      priceGrossEur: listing.price_gross_eur?.toString() ?? null,
      action: input.action,
    };
    const payloadDigest = digestAutoscout24DmsPushPayload(payload);

    const prepare = await this.prisma.$transaction(async (tx) => {
      const { id: syncId } = await ensureDmsSyncRow(tx, {
        tenantId,
        channelId: channel.id,
        provider: VehicleListingDmsProvider.AS24_DMS,
      });
      await lockVehicleListingChannelDmsSyncRow(tx, tenantId, syncId);
      const row = await tx.vehicleListingChannelDmsSync.findFirstOrThrow({
        where: { tenant_id: tenantId, id: syncId },
      });

      const replay = this.tryIdempotentReplay(row, input, payloadDigest);
      if (replay) {
        return { kind: 'replay' as const, row, replay };
      }

      if (
        row.last_idempotency_key === input.idempotency_key &&
        row.last_sync_payload_digest &&
        row.last_sync_payload_digest !== payloadDigest
      ) {
        throw new ConflictException({
          code: 'LISTING_PUSH_IDEMPOTENCY_CONFLICT',
          message:
            'The idempotency key was already used with a different listing payload.',
        });
      }

      const pending = await tx.vehicleListingChannelDmsSync.update({
        where: { tenant_id: tenantId, id: syncId },
        data: {
          sync_state: VehicleListingDmsSyncState.PENDING,
          last_idempotency_key: input.idempotency_key,
          last_sync_payload_digest: payloadDigest,
        },
      });
      return {
        kind: 'pending' as const,
        row: pending,
        syncId,
        externalRef: row.external_listing_id ?? channel.external_ref,
      };
    });

    if (prepare.kind === 'replay') {
      return this.toDto(prepare.row, channel.id, true);
    }

    const ctx: PushContext = {
      tenantId,
      channelId: channel.id,
      listingRef: listing.listing_ref,
      externalRef: prepare.externalRef,
      payloadDigest,
      syncId: prepare.syncId,
    };

    try {
      if (input.action === 'DEACTIVATE') {
        return await this.runDeactivate(input.idempotency_key, payload, ctx);
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
        ctx.externalRef,
      );

      const updated = await this.commitSuccess(ctx, input.idempotency_key, {
        sync_state: VehicleListingDmsSyncState.SYNCED,
        external_listing_id: result.externalListingId,
        channel_external_ref: result.externalListingId,
      });

      return this.toDto(updated, channel.id, result.idempotentReplay);
    } catch (error) {
      await this.handlePushFailure(ctx, input.idempotency_key, error);
      throw this.mapThrownError(error).exception;
    }
  }

  private async runDeactivate(
    idempotencyKey: string,
    payload: {
      sellerListingRef: string;
      title: string | null;
      priceGrossEur: string | null;
      action: Autoscout24DmsPushAction;
    },
    ctx: PushContext,
  ): Promise<Autoscout24DmsPushResultDto> {
    try {
      const result = await this.publisher.deactivateListing(
        idempotencyKey,
        payload,
        ctx.externalRef,
      );
      const updated = await this.commitSuccess(ctx, idempotencyKey, {
        sync_state: VehicleListingDmsSyncState.DEACTIVATED,
        external_listing_id:
          result.externalListingId ?? ctx.externalRef ?? null,
      });
      return this.toDto(updated, ctx.channelId, result.idempotentReplay);
    } catch (error) {
      await this.handlePushFailure(ctx, idempotencyKey, error);
      throw this.mapThrownError(error).exception;
    }
  }

  private tryIdempotentReplay(
    row: VehicleListingChannelDmsSync,
    input: { idempotency_key: string; action: Autoscout24DmsPushAction },
    payloadDigest: string,
  ): boolean | null {
    if (row.last_idempotency_key !== input.idempotency_key) {
      return null;
    }
    if (row.last_sync_payload_digest !== payloadDigest) {
      return null;
    }
    if (
      input.action === 'UPSERT' &&
      row.sync_state === VehicleListingDmsSyncState.SYNCED
    ) {
      return true;
    }
    if (
      input.action === 'DEACTIVATE' &&
      row.sync_state === VehicleListingDmsSyncState.DEACTIVATED
    ) {
      return true;
    }
    return null;
  }

  private async commitSuccess(
    ctx: PushContext,
    idempotencyKey: string,
    outcome: {
      sync_state: VehicleListingDmsSyncState;
      external_listing_id: string | null;
      channel_external_ref?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockVehicleListingChannelDmsSyncRow(tx, ctx.tenantId, ctx.syncId);
      const current = await tx.vehicleListingChannelDmsSync.findFirstOrThrow({
        where: { tenant_id: ctx.tenantId, id: ctx.syncId },
      });
      if (current.last_idempotency_key !== idempotencyKey) {
        throw new ConflictException({
          code: 'LISTING_PUSH_IDEMPOTENCY_CONFLICT',
          message: 'Another push request superseded this attempt.',
        });
      }

      const now = new Date();
      const sync = await tx.vehicleListingChannelDmsSync.update({
        where: { tenant_id: ctx.tenantId, id: ctx.syncId },
        data: {
          sync_state: outcome.sync_state,
          last_sync_at: now,
          last_sync_error_code: null,
          external_listing_id: outcome.external_listing_id,
          last_sync_payload_digest: ctx.payloadDigest,
        },
      });
      if (outcome.channel_external_ref !== undefined) {
        await tx.vehicleListingChannel.updateMany({
          where: { tenant_id: ctx.tenantId, id: ctx.channelId },
          data: { external_ref: outcome.channel_external_ref },
        });
      }
      return sync;
    });
  }

  private async handlePushFailure(
    ctx: PushContext,
    idempotencyKey: string,
    error: unknown,
  ): Promise<void> {
    const mapped = this.mapThrownError(error);
    if (mapped.persistFailure === false) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      await lockVehicleListingChannelDmsSyncRow(tx, ctx.tenantId, ctx.syncId);
      const current = await tx.vehicleListingChannelDmsSync.findFirst({
        where: { tenant_id: ctx.tenantId, id: ctx.syncId },
      });
      if (!current || current.last_idempotency_key !== idempotencyKey) {
        return;
      }
      await tx.vehicleListingChannelDmsSync.update({
        where: { tenant_id: ctx.tenantId, id: ctx.syncId },
        data: {
          sync_state: VehicleListingDmsSyncState.FAILED,
          last_sync_at: new Date(),
          last_sync_error_code: mapped.code,
        },
      });
    });
  }

  private mapThrownError(error: unknown): {
    code: string;
    exception: Error;
    persistFailure: boolean;
  } {
    if (error instanceof HttpException) {
      let code = 'LISTING_PUSH_PROVIDER_ERROR';
      const response = error.getResponse();
      if (
        typeof response === 'object' &&
        response !== null &&
        'code' in response &&
        typeof response.code === 'string'
      ) {
        code = response.code;
      }
      return { code, exception: error, persistFailure: true };
    }
    if (error instanceof Autoscout24DmsAdapterError) {
      if (error.code === 'timeout') {
        return {
          code: 'LISTING_PUSH_TIMEOUT',
          persistFailure: true,
          exception: new BadGatewayException({
            code: 'LISTING_PUSH_TIMEOUT',
            message: 'AutoScout24 DMS API request timed out.',
          }),
        };
      }
      if (error.code === 'rate_limit') {
        return {
          code: 'LISTING_PUSH_RATE_LIMIT',
          persistFailure: false,
          exception: new BadGatewayException({
            code: 'LISTING_PUSH_RATE_LIMIT',
            message: 'AutoScout24 DMS API rate limit exceeded. Retry later.',
          }),
        };
      }
      if (error.code === 'client_error') {
        return {
          code: 'LISTING_PUSH_CLIENT_ERROR',
          persistFailure: true,
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
          persistFailure: true,
        };
      }
      return {
        code: 'LISTING_PUSH_PROVIDER_ERROR',
        persistFailure: true,
        exception: new BadGatewayException({
          code: 'LISTING_PUSH_PROVIDER_ERROR',
          message: 'AutoScout24 DMS API is temporarily unavailable.',
        }),
      };
    }
    if (error instanceof ConflictException) {
      return {
        code: 'LISTING_PUSH_IDEMPOTENCY_CONFLICT',
        exception: error,
        persistFailure: false,
      };
    }
    if (error instanceof Error) {
      return {
        code: 'LISTING_PUSH_PROVIDER_ERROR',
        exception: error,
        persistFailure: true,
      };
    }
    return {
      code: 'LISTING_PUSH_PROVIDER_ERROR',
      persistFailure: true,
      exception: new BadGatewayException({
        code: 'LISTING_PUSH_PROVIDER_ERROR',
        message: 'AutoScout24 DMS API is temporarily unavailable.',
      }),
    };
  }

  private toDto(
    row: {
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
