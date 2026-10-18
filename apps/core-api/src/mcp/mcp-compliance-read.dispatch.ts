import type { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import type { McpComplianceReadToolName } from './mcp-read-tool-catalog.aut605.js';
import type {
  checkContactPermissionInputSchema,
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
} from './mcp-tool-schemas.compliance-reads.js';
import type { z } from 'zod';

export function runMcpComplianceReadTool(
  facade: McpComplianceReadFacade,
  toolName: McpComplianceReadToolName,
  parsed: unknown,
): Promise<unknown> {
  switch (toolName) {
    case 'check_contact_permission':
      return facade.checkContactPermission(
        parsed as z.infer<typeof checkContactPermissionInputSchema>,
      );
    case 'list_gewaehrleistung_due':
      return facade.listGewaehrleistungDue(
        parsed as z.infer<typeof listGewaehrleistungDueInputSchema>,
      );
    case 'list_tyre_sets':
      return facade.listTyreSets(
        parsed as z.infer<typeof listTyreSetsInputSchema>,
      );
    case 'list_warranty_claims':
      return facade.listWarrantyClaims(
        parsed as z.infer<typeof listWarrantyClaimsInputSchema>,
      );
  }
}
