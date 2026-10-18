import { Injectable, Logger } from '@nestjs/common';
import type { Autoscout24DmsListingPublisherPort } from './autoscout24-dms-api.port.js';
import {
  Autoscout24DmsAdapterError,
  type Autoscout24DmsCredentials,
  type Autoscout24DmsDeactivateResult,
  type Autoscout24DmsListingPayload,
  type Autoscout24DmsUpsertResult,
} from './autoscout24-dms-api.types.js';
import {
  isAutoscout24DmsHttpConfigured,
  readAutoscout24DmsBaseUrl,
  readAutoscout24DmsHttpTimeoutMs,
} from './autoscout24-dms-env.js';

export type Autoscout24DmsCredentialResolver =
  () => Promise<Autoscout24DmsCredentials | null>;

type FetchLike = typeof fetch;

/**
 * Live HTTP shell for AutoScout24 DMS listing push. Credentials and base URL are
 * resolved only when this adapter is selected (push flags on, fake adapter off).
 */
@Injectable()
export class HttpAutoscout24DmsListingPublisherAdapter implements Autoscout24DmsListingPublisherPort {
  private readonly logger = new Logger(
    HttpAutoscout24DmsListingPublisherAdapter.name,
  );

  constructor(
    private readonly resolveCredentials: Autoscout24DmsCredentialResolver | null,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async upsertListing(
    idempotencyKey: string,
    payload: Autoscout24DmsListingPayload,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsUpsertResult> {
    const credentials = await this.requireCredentials();
    const baseUrl = this.requireBaseUrl();
    const path = existingExternalListingId
      ? `/api/v1/listings/${encodeURIComponent(existingExternalListingId)}`
      : '/api/v1/listings';
    const method = existingExternalListingId ? 'PUT' : 'POST';

    const response = await this.request(
      baseUrl,
      path,
      method,
      credentials,
      idempotencyKey,
      {
        sellerListingRef: payload.sellerListingRef,
        title: payload.title,
        priceGrossEur: payload.priceGrossEur,
        action: payload.action,
      },
    );

    const externalListingId = this.readExternalListingId(
      response.body,
      existingExternalListingId,
    );
    return {
      kind: 'upsert',
      externalListingId,
      httpStatus: response.status,
      idempotentReplay:
        response.status === 200 && Boolean(existingExternalListingId),
    };
  }

  async deactivateListing(
    idempotencyKey: string,
    payload: Pick<Autoscout24DmsListingPayload, 'sellerListingRef'>,
    existingExternalListingId: string | null,
  ): Promise<Autoscout24DmsDeactivateResult> {
    const credentials = await this.requireCredentials();
    const baseUrl = this.requireBaseUrl();
    const externalId =
      existingExternalListingId ?? encodeURIComponent(payload.sellerListingRef);
    const response = await this.request(
      baseUrl,
      `/api/v1/listings/${externalId}`,
      'DELETE',
      credentials,
      idempotencyKey,
      { sellerListingRef: payload.sellerListingRef, action: 'DEACTIVATE' },
    );

    return {
      kind: 'deactivate',
      externalListingId: existingExternalListingId,
      httpStatus: response.status,
      idempotentReplay: response.status === 200,
    };
  }

  private requireBaseUrl(): string {
    const baseUrl = readAutoscout24DmsBaseUrl();
    if (!baseUrl) {
      throw new Autoscout24DmsAdapterError(
        'unconfigured',
        'AutoScout24 DMS base URL is not configured.',
      );
    }
    return baseUrl;
  }

  private async requireCredentials(): Promise<Autoscout24DmsCredentials> {
    if (!isAutoscout24DmsHttpConfigured()) {
      throw new Autoscout24DmsAdapterError(
        'unconfigured',
        'AutoScout24 DMS credentials are not configured.',
      );
    }
    if (!this.resolveCredentials) {
      throw new Autoscout24DmsAdapterError(
        'unconfigured',
        'AutoScout24 DMS credential resolver is not wired.',
      );
    }
    const credentials = await this.resolveCredentials();
    if (!credentials?.clientId || !credentials.clientSecret) {
      throw new Autoscout24DmsAdapterError(
        'unconfigured',
        'AutoScout24 DMS credentials are unavailable.',
      );
    }
    return credentials;
  }

  private readExternalListingId(
    body: unknown,
    fallback: string | null,
  ): string {
    if (body && typeof body === 'object') {
      const record = body as Record<string, unknown>;
      const candidate = record.externalListingId ?? record.id;
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        return candidate;
      }
    }
    if (fallback) {
      return fallback;
    }
    throw new Autoscout24DmsAdapterError(
      'client_error',
      'AutoScout24 DMS response did not include an external listing id.',
      502,
    );
  }

  private async request(
    baseUrl: string,
    path: string,
    method: string,
    credentials: Autoscout24DmsCredentials,
    idempotencyKey: string,
    jsonBody: Record<string, unknown>,
  ): Promise<{ status: number; body: unknown }> {
    const timeoutMs = readAutoscout24DmsHttpTimeoutMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = `${baseUrl}${path}`;

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(
            `${credentials.clientId}:${credentials.clientSecret}`,
          ).toString('base64')}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(jsonBody),
        signal: controller.signal,
      });

      const text = await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = null;
        }
      }

      if (response.status >= 500) {
        throw new Autoscout24DmsAdapterError(
          'server_error',
          'AutoScout24 DMS API returned a server error.',
          response.status,
        );
      }
      if (response.status >= 400) {
        throw new Autoscout24DmsAdapterError(
          'client_error',
          'AutoScout24 DMS API rejected the listing request.',
          response.status,
        );
      }

      return { status: response.status, body };
    } catch (error) {
      if (error instanceof Autoscout24DmsAdapterError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Autoscout24DmsAdapterError(
          'timeout',
          'AutoScout24 DMS API request timed out.',
        );
      }
      this.logger.debug(
        `AutoScout24 DMS HTTP call failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new Autoscout24DmsAdapterError(
        'network_error',
        'AutoScout24 DMS API request failed.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
