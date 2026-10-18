import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { TyreSetListReadService } from '../tyre-storage/tyre-set-list-read.service.js';
import { TyreStorageService } from '../tyre-storage/tyre-storage.service.js';
import { VehicleStockQueryService } from '../vehicle-stock/vehicle-stock-query.service.js';
import { WarrantyClaimSiteListService } from '../warranty-claim/warranty-claim-site-list.service.js';
import { assertWarrantyClaimAccess } from '../warranty-claim/warranty-claim.rules.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { mcpListGewaehrleistungDue } from './mcp-compliance-read.gewaehrleistung.js';
import { mcpListTyreSets } from './mcp-compliance-read.tyre-sets.js';
import { mcpListWarrantyClaims } from './mcp-compliance-read.warranty-claims.js';
import { offsetFromCursor } from './mcp-report-read.mapper.js';
import { clampMcpPageSize } from './mcp-output.util.js';
import type {
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
} from './mcp-tool-schemas.js';

@Injectable()
export class McpComplianceReadListsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly vehicleStock: VehicleStockQueryService,
    private readonly tyreStorage: TyreStorageService,
    private readonly tyreSetListRead: TyreSetListReadService,
    private readonly warrantyClaimSiteList: WarrantyClaimSiteListService,
  ) {}

  listGewaehrleistungDue(
    input: z.infer<typeof listGewaehrleistungDueInputSchema>,
  ) {
    return mcpListGewaehrleistungDue(this.vehicleStock, input);
  }

  listTyreSets(input: z.infer<typeof listTyreSetsInputSchema>) {
    const pageSize = clampMcpPageSize(input.pageSize);
    const offset = offsetFromCursor(input.cursor);
    return mcpListTyreSets(
      this.tyreStorage,
      this.tyreSetListRead,
      input,
      pageSize,
      offset,
    );
  }

  listWarrantyClaims(input: z.infer<typeof listWarrantyClaimsInputSchema>) {
    assertWarrantyClaimAccess(this.tenantContext);
    const pageSize = clampMcpPageSize(input.pageSize);
    return mcpListWarrantyClaims(this.warrantyClaimSiteList, input, pageSize);
  }
}
