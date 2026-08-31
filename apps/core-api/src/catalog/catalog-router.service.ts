import { Inject, Injectable } from '@nestjs/common';
import { CatalogProviderError } from './providers/catalog-provider.error';
import type {
  CatalogAssemblyGroupNode,
  CatalogFallbackReason,
  CatalogLaborHit,
  CatalogOemStatus,
  CatalogPartsHit,
  CatalogSearchConcern,
  CatalogSearchContext,
  CatalogSearchSource,
} from './providers/catalog-provider.types';
import { CatalogAdapterRegistry } from './catalog-adapter.registry';

export type CatalogExternalSearchResult = {
  concern: CatalogSearchConcern;
  sourceUsed: 'OEM' | 'AFTERMARKET';
  oemStatus: CatalogOemStatus;
  fallbackRequired: boolean;
  fallbackReason: CatalogFallbackReason;
  retryOemAvailable: boolean;
  items: CatalogPartsHit[] | CatalogLaborHit[];
};

type ProviderSettingsSnapshot = {
  defaultPartsAftermarketAdapterId: string | null;
  defaultLaborAftermarketAdapterId: string | null;
};

type OemConcernSnapshot = {
  partsAdapterId: string | null;
  laborAdapterId: string | null;
} | null;

@Injectable()
export class CatalogRouterService {
  constructor(
    @Inject(CatalogAdapterRegistry)
    private readonly adapters: CatalogAdapterRegistry,
  ) {}

  async search(params: {
    context: CatalogSearchContext;
    concern: CatalogSearchConcern;
    source: CatalogSearchSource;
    confirmFallback: boolean;
    settings: ProviderSettingsSnapshot;
    oemConcern: OemConcernSnapshot;
  }): Promise<CatalogExternalSearchResult> {
    const { context, concern, source, confirmFallback, settings, oemConcern } =
      params;

    if (source === 'AFTERMARKET') {
      const items = await this.searchAftermarket(context, concern, settings);
      return {
        concern,
        sourceUsed: 'AFTERMARKET',
        oemStatus: this.resolveAftermarketOemStatus(oemConcern, concern),
        fallbackRequired: false,
        fallbackReason: null,
        retryOemAvailable: this.hasOemAdapter(oemConcern, concern),
        items,
      };
    }

    if (source === 'OEM') {
      return this.searchOemChain({
        context,
        concern,
        confirmFallback,
        settings,
        oemConcern,
        allowAftermarketFallback: confirmFallback,
      });
    }

    return this.searchAutoChain({
      context,
      concern,
      confirmFallback,
      settings,
      oemConcern,
    });
  }

  async listAssemblyGroups(params: {
    context: Omit<CatalogSearchContext, 'query'>;
    settings: ProviderSettingsSnapshot;
    oemConcern: OemConcernSnapshot;
  }): Promise<CatalogAssemblyGroupNode[]> {
    const adapterId = this.resolveActivePartsAdapterId(
      params.settings,
      params.oemConcern,
    );
    if (!adapterId) {
      return [];
    }

    const provider = this.adapters.getPartsProvider();
    if (!provider.listAssemblyGroups) {
      return [];
    }

    return provider.listAssemblyGroups(params.context, adapterId);
  }

  private async searchAutoChain(params: {
    context: CatalogSearchContext;
    concern: CatalogSearchConcern;
    confirmFallback: boolean;
    settings: ProviderSettingsSnapshot;
    oemConcern: OemConcernSnapshot;
  }): Promise<CatalogExternalSearchResult> {
    const oemAdapterId = this.getOemAdapterId(
      params.oemConcern,
      params.concern,
    );
    if (!oemAdapterId) {
      const items = await this.searchAftermarket(
        params.context,
        params.concern,
        params.settings,
      );
      return {
        concern: params.concern,
        sourceUsed: 'AFTERMARKET',
        oemStatus: 'NOT_CONFIGURED',
        fallbackRequired: false,
        fallbackReason: null,
        retryOemAvailable: false,
        items,
      };
    }

    return this.searchOemChain({
      ...params,
      allowAftermarketFallback: params.confirmFallback,
    });
  }

  private async searchOemChain(params: {
    context: CatalogSearchContext;
    concern: CatalogSearchConcern;
    confirmFallback: boolean;
    settings: ProviderSettingsSnapshot;
    oemConcern: OemConcernSnapshot;
    allowAftermarketFallback: boolean;
  }): Promise<CatalogExternalSearchResult> {
    const oemAdapterId = this.getOemAdapterId(
      params.oemConcern,
      params.concern,
    );
    if (!oemAdapterId) {
      const items = await this.searchAftermarket(
        params.context,
        params.concern,
        params.settings,
      );
      return {
        concern: params.concern,
        sourceUsed: 'AFTERMARKET',
        oemStatus: 'NOT_CONFIGURED',
        fallbackRequired: false,
        fallbackReason: null,
        retryOemAvailable: false,
        items,
      };
    }

    try {
      const oemItems = await this.searchOem(
        params.context,
        params.concern,
        oemAdapterId,
      );
      if (oemItems.length > 0) {
        return {
          concern: params.concern,
          sourceUsed: 'OEM',
          oemStatus: 'HIT',
          fallbackRequired: false,
          fallbackReason: null,
          retryOemAvailable: true,
          items: oemItems,
        };
      }

      if (!params.allowAftermarketFallback) {
        return {
          concern: params.concern,
          sourceUsed: 'OEM',
          oemStatus: 'EMPTY',
          fallbackRequired: true,
          fallbackReason: 'EMPTY',
          retryOemAvailable: true,
          items: [],
        };
      }

      const aftermarketItems = await this.searchAftermarket(
        params.context,
        params.concern,
        params.settings,
      );
      return {
        concern: params.concern,
        sourceUsed: 'AFTERMARKET',
        oemStatus: 'EMPTY',
        fallbackRequired: false,
        fallbackReason: 'EMPTY',
        retryOemAvailable: true,
        items: aftermarketItems,
      };
    } catch (error) {
      if (!(error instanceof CatalogProviderError)) {
        throw error;
      }

      if (!params.allowAftermarketFallback) {
        return {
          concern: params.concern,
          sourceUsed: 'OEM',
          oemStatus: 'ERROR',
          fallbackRequired: true,
          fallbackReason: 'ERROR',
          retryOemAvailable: true,
          items: [],
        };
      }

      const aftermarketItems = await this.searchAftermarket(
        params.context,
        params.concern,
        params.settings,
      );
      return {
        concern: params.concern,
        sourceUsed: 'AFTERMARKET',
        oemStatus: 'ERROR',
        fallbackRequired: false,
        fallbackReason: 'ERROR',
        retryOemAvailable: true,
        items: aftermarketItems,
      };
    }
  }

  private async searchOem(
    context: CatalogSearchContext,
    concern: CatalogSearchConcern,
    adapterId: string,
  ): Promise<CatalogPartsHit[] | CatalogLaborHit[]> {
    if (concern === 'PARTS') {
      return this.adapters.getPartsProvider().search(context, adapterId);
    }

    return this.adapters.getLaborProvider().search(context, adapterId);
  }

  private async searchAftermarket(
    context: CatalogSearchContext,
    concern: CatalogSearchConcern,
    settings: ProviderSettingsSnapshot,
  ): Promise<CatalogPartsHit[] | CatalogLaborHit[]> {
    const adapterId =
      concern === 'PARTS'
        ? settings.defaultPartsAftermarketAdapterId
        : settings.defaultLaborAftermarketAdapterId;

    if (!adapterId) {
      return [];
    }

    return this.searchOem(context, concern, adapterId);
  }

  private resolveActivePartsAdapterId(
    settings: ProviderSettingsSnapshot,
    oemConcern: OemConcernSnapshot,
  ): string | null {
    return (
      oemConcern?.partsAdapterId ?? settings.defaultPartsAftermarketAdapterId
    );
  }

  private getOemAdapterId(
    oemConcern: OemConcernSnapshot,
    concern: CatalogSearchConcern,
  ): string | null {
    if (!oemConcern) {
      return null;
    }

    return concern === 'PARTS'
      ? oemConcern.partsAdapterId
      : oemConcern.laborAdapterId;
  }

  private hasOemAdapter(
    oemConcern: OemConcernSnapshot,
    concern: CatalogSearchConcern,
  ): boolean {
    return Boolean(this.getOemAdapterId(oemConcern, concern));
  }

  private resolveAftermarketOemStatus(
    oemConcern: OemConcernSnapshot,
    concern: CatalogSearchConcern,
  ): CatalogOemStatus {
    return this.hasOemAdapter(oemConcern, concern) ? 'HIT' : 'NOT_CONFIGURED';
  }
}
