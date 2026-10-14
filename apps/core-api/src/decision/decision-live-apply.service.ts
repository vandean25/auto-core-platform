import { Injectable } from '@nestjs/common';
import type { DecisionApplyMode } from './decision.constants.js';
import { DecisionCustomerImportApplier } from './decision-customer-import-apply.service.js';
import { DecisionDocumentSortApplier } from './decision-document-sort-apply.service.js';
import type {
  CustomerImportDecisionParams,
  CustomerImportLiveResult,
  DocumentSortDecisionParams,
} from './decision-live-apply.types.js';
import { DecisionModeResolver } from './decision-mode-resolver.service.js';

export type {
  CustomerImportLiveResult,
  DecisionLiveOutcome,
  DecisionLiveReason,
} from './decision-live-apply.types.js';

/**
 * AUT-413 live-apply. Awaits Jev only where the rules leave a gap, then applies,
 * proposes or refuses the suggestion by policy tier. Never throws into the caller.
 *
 * Facade: the public API stays here, and the work runs in the collaborators that
 * DecisionModule registers.
 */
@Injectable()
export class DecisionLiveApplyService {
  constructor(
    private readonly modes: DecisionModeResolver,
    private readonly customerImport: DecisionCustomerImportApplier,
    private readonly documentSort: DecisionDocumentSortApplier,
  ) {}

  /**
   * Environment first, so a shadow deployment never reads the tenant row. A
   * tenant can only opt out (`shadow`); it can never turn live on.
   */
  resolveEffectiveMode(tenantId: string): Promise<DecisionApplyMode> {
    return this.modes.resolveEffectiveMode(tenantId);
  }

  isLiveForTenant(tenantId: string): Promise<boolean> {
    return this.modes.isLiveForTenant(tenantId);
  }

  applyCustomerImportDecisions(
    params: CustomerImportDecisionParams,
  ): Promise<CustomerImportLiveResult> {
    return this.customerImport.apply(params);
  }

  /**
   * Doc sort: the heuristic is final unless it returns Sonstiges. Runs after the
   * asset is READY, so AUTO never writes a type to a rejected or quarantined asset.
   */
  applyDocumentSortForAsset(params: DocumentSortDecisionParams): Promise<void> {
    return this.documentSort.apply(params);
  }
}
