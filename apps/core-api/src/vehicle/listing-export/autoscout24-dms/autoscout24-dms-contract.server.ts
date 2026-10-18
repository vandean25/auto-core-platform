import { createHash } from 'node:crypto';
import {
  Autoscout24DmsAdapterError,
  type Autoscout24DmsDeactivateResult,
  type Autoscout24DmsListingPayload,
  type Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';

export type FakeAutoscout24DmsBehavior =
  'success' | 'reject400' | 'reject429' | 'reject500' | 'timeout';

type StoredListing = {
  sellerListingRef: string;
  externalListingId: string;
  body: Autoscout24DmsListingPayload;
  idempotencyKey: string;
};

type DeactivateReplay = {
  idempotencyKey: string;
  externalListingId: string | null;
};

/**
 * In-memory AutoScout24 DMS contract for unit tests. Never used in production HTTP.
 */
export class FakeAutoscout24DmsContractServer {
  private readonly listings = new Map<string, StoredListing>();
  private readonly deactivateReplays = new Map<string, DeactivateReplay>();
  private behavior: FakeAutoscout24DmsBehavior = 'success';
  readonly calls: Array<{
    method: 'UPSERT' | 'DEACTIVATE';
    sellerListingRef: string;
    idempotencyKey: string;
  }> = [];

  reset(): void {
    this.listings.clear();
    this.deactivateReplays.clear();
    this.calls.length = 0;
    this.behavior = 'success';
  }

  configure(behavior: FakeAutoscout24DmsBehavior): void {
    this.behavior = behavior;
  }

  private externalIdForSellerRef(sellerListingRef: string): string {
    return `as24-fake-${createHash('sha256').update(sellerListingRef).digest('hex').slice(0, 16)}`;
  }

  private async applyBehavior(): Promise<void> {
    if (this.behavior === 'timeout') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error('FAKE_TIMEOUT');
    }
    if (this.behavior === 'reject400') {
      throw new Autoscout24DmsAdapterError('client_error', 'FAKE_400', 400);
    }
    if (this.behavior === 'reject429') {
      throw new Autoscout24DmsAdapterError('rate_limit', 'FAKE_429', 429);
    }
    if (this.behavior === 'reject500') {
      throw new Autoscout24DmsAdapterError('server_error', 'FAKE_500', 500);
    }
  }

  async upsertListing(
    idempotencyKey: string,
    payload: Autoscout24DmsListingPayload,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult> {
    await this.applyBehavior();
    this.calls.push({
      method: 'UPSERT',
      sellerListingRef: payload.sellerListingRef,
      idempotencyKey,
    });

    const existing = this.listings.get(payload.sellerListingRef);
    if (
      existing &&
      existing.idempotencyKey === idempotencyKey &&
      JSON.stringify(existing.body) === JSON.stringify(payload)
    ) {
      return {
        kind: 'upsert',
        externalListingId: existing.externalListingId,
        httpStatus: 200,
        idempotentReplay: true,
      };
    }

    const externalListingId =
      existingExternalListingId ??
      existing?.externalListingId ??
      this.externalIdForSellerRef(payload.sellerListingRef);

    this.listings.set(payload.sellerListingRef, {
      sellerListingRef: payload.sellerListingRef,
      externalListingId,
      body: payload,
      idempotencyKey,
    });

    return {
      kind: 'upsert',
      externalListingId,
      httpStatus: existing ? 200 : 201,
      idempotentReplay: false,
    };
  }

  async deactivateListing(
    idempotencyKey: string,
    sellerListingRef: string,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsDeactivateResult> {
    await this.applyBehavior();
    this.calls.push({
      method: 'DEACTIVATE',
      sellerListingRef,
      idempotencyKey,
    });

    const replay = this.deactivateReplays.get(sellerListingRef);
    if (replay?.idempotencyKey === idempotencyKey) {
      return {
        kind: 'deactivate',
        externalListingId: replay.externalListingId,
        httpStatus: 200,
        idempotentReplay: true,
      };
    }

    const existing = this.listings.get(sellerListingRef);
    const externalListingId =
      existingExternalListingId ?? existing?.externalListingId ?? null;
    this.listings.delete(sellerListingRef);
    this.deactivateReplays.set(sellerListingRef, {
      idempotencyKey,
      externalListingId,
    });

    return {
      kind: 'deactivate',
      externalListingId,
      httpStatus: 200,
      idempotentReplay: false,
    };
  }
}
