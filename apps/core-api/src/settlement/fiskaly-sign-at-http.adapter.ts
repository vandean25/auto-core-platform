import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type {
  FiskalySignAtProvider,
  FiskalySignAtProviderResult,
} from './fiskaly-sign-at.types.js';
import { isFiskalySignAtLiveEnabled } from './settlement.constants.js';

export type FiskalyCredentialResolver = () => Promise<{
  apiKey: string;
  apiSecret: string;
} | null>;

/**
 * Narrow live adapter shell. CI and default deployments never enable live HTTP.
 * Credentials are resolved only when `FISKALY_SIGN_AT_LIVE_ENABLED=true` and a resolver is injected.
 */
@Injectable()
export class FiskalySignAtHttpAdapter implements FiskalySignAtProvider {
  constructor(
    private readonly resolveCredentials: FiskalyCredentialResolver | null,
  ) {}

  async signReceipt(): Promise<FiskalySignAtProviderResult> {
    return this.refuseLive();
  }

  async retrieveReceipt(): Promise<FiskalySignAtProviderResult> {
    return this.refuseLive();
  }

  private async refuseLive(): Promise<FiskalySignAtProviderResult> {
    if (!isFiskalySignAtLiveEnabled()) {
      throw new ServiceUnavailableException(
        'fiskaly SIGN AT live adapter is disabled. Set FISKALY_SIGN_AT_LIVE_ENABLED=true and supply credentials for live signing.',
      );
    }
    if (!this.resolveCredentials) {
      throw new ServiceUnavailableException(
        'fiskaly SIGN AT credential resolver is not configured.',
      );
    }
    const credentials = await this.resolveCredentials();
    if (!credentials) {
      throw new ServiceUnavailableException(
        'fiskaly SIGN AT credentials are not available for this register.',
      );
    }
    throw new ServiceUnavailableException(
      'fiskaly SIGN AT live HTTP is not wired in this deployment slice.',
    );
  }
}
