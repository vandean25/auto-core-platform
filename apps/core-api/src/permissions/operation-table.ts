import { ADMIN_OPERATIONS } from './operation-table.admin.js';
import { CLASSIFIED_OPERATIONS } from './operation-table.classified.js';
import { INVENTORY_OPERATIONS } from './operation-table.inventory.js';
import { PEOPLE_OPERATIONS } from './operation-table.people.js';
import { PROCUREMENT_OPERATIONS } from './operation-table.procurement.js';
import { SALES_OPERATIONS } from './operation-table.sales.js';
import { VEHICLE_OPERATIONS } from './operation-table.vehicle.js';
import { WORKSHOP_OPERATIONS } from './operation-table.workshop.js';
import type { OperationTable } from './operation-types.js';

export { MCP_TOOL_TABLE } from './operation-table.mcp.js';

/**
 * Every registered HTTP route, keyed by controller class name and handler name.
 * Protected operations name their permissions; routes outside tenant-role authorization carry an explicit policy.
 */
export const OPERATION_TABLE: OperationTable = {
  ...INVENTORY_OPERATIONS,
  ...PROCUREMENT_OPERATIONS,
  ...SALES_OPERATIONS,
  ...WORKSHOP_OPERATIONS,
  ...VEHICLE_OPERATIONS,
  ...PEOPLE_OPERATIONS,
  ...ADMIN_OPERATIONS,
  ...CLASSIFIED_OPERATIONS,
};
