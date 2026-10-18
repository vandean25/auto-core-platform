import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { McpComplianceReadListsService } from './mcp-compliance-read-lists.service.js';
import { McpComplianceReadService } from './mcp-compliance-read.service.js';
import type {
  checkContactPermissionInputSchema,
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
} from './mcp-tool-schemas.js';

/** Routes MCP compliance read tools to contact vs list services. */
@Injectable()
export class McpComplianceReadFacade {
  constructor(
    private readonly contact: McpComplianceReadService,
    private readonly lists: McpComplianceReadListsService,
  ) {}

  checkContactPermission(
    input: z.infer<typeof checkContactPermissionInputSchema>,
  ) {
    return this.contact.checkContactPermission(input);
  }

  listGewaehrleistungDue(
    input: z.infer<typeof listGewaehrleistungDueInputSchema>,
  ) {
    return this.lists.listGewaehrleistungDue(input);
  }

  listTyreSets(input: z.infer<typeof listTyreSetsInputSchema>) {
    return this.lists.listTyreSets(input);
  }

  listWarrantyClaims(input: z.infer<typeof listWarrantyClaimsInputSchema>) {
    return this.lists.listWarrantyClaims(input);
  }
}
