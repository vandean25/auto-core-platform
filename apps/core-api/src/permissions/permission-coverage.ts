import { isPermissionId } from './permission-catalogue.js';
import type {
  ClassifiedOperation,
  McpToolTable,
  OperationEntry,
  OperationTable,
} from './operation-types.js';
import type { RegisteredRoute } from './route-inventory.js';

/** Guards that identify a service-job route: Cloud Tasks workers and the scheduler call. */
const SERVICE_JOB_GUARDS = ['CloudTasksWorkerGuard', 'CronInvokerOidcGuard'];

type EntryKind = OperationEntry['kind'];

/** The entry kinds the route's own metadata allows. A route cannot be classified against its metadata. */
function allowedKinds(route: RegisteredRoute): readonly EntryKind[] {
  if (route.publicApiScope) {
    return ['api_key'];
  }
  if (route.guards.includes('SuperAdminGuard')) {
    return ['platform_admin'];
  }
  if (route.isPublic) {
    return route.guards.some((guard) => SERVICE_JOB_GUARDS.includes(guard))
      ? ['service_job']
      : ['public', 'mcp_gateway'];
  }
  if (route.guards.includes('InteractiveUserGuard')) {
    return ['session'];
  }
  return ['protected', 'session'];
}

/** Permission identifiers an entry names that are not in the catalogue. */
export function findUnknownPermissions(
  table: Readonly<Record<string, object>>,
): string[] {
  return Object.entries(table).flatMap(([key, entry]) =>
    ('permissions' in entry ? (entry.permissions as readonly string[]) : [])
      .filter((permission) => !isPermissionId(permission))
      .map((permission) => `unknown permission "${permission}" in ${key}`),
  );
}

/** A message naming `where` when the entry is incomplete, otherwise null. */
function describeEntryProblem(
  entry: OperationEntry | ClassifiedOperation,
  where: string,
): string | null {
  if (entry.kind === 'protected') {
    if (entry.permissions.length === 0) {
      return `${where} has no permission`;
    }
    if (entry.legacy.length === 0 || entry.principals.length === 0) {
      return `${where} records no legacy access or principal`;
    }
    return null;
  }
  if (entry.kind === 'api_key' && entry.permissions.length === 0) {
    return `${where} has no permission`;
  }
  return entry.policy.trim() === '' ? `${where} has no policy text` : null;
}

function findRouteProblems(
  routes: readonly RegisteredRoute[],
  table: OperationTable,
): string[] {
  const problems = routes.flatMap((route) => {
    const where = `${route.method} ${route.path} (${route.id})`;
    const entry = table[route.id];
    if (!entry) {
      return [`${where} has no operation entry`];
    }
    const allowed = allowedKinds(route);
    return [
      allowed.includes(entry.kind)
        ? null
        : `${where} is classified as ${entry.kind} but its metadata requires ${allowed.join(' or ')}`,
      entry.kind === 'api_key' && entry.apiKeyScope !== route.publicApiScope
        ? `${where} maps API key scope ${entry.apiKeyScope}`
        : null,
      describeEntryProblem(entry, where),
    ].filter((problem) => problem !== null);
  });
  const routeIds = new Set(routes.map((route) => route.id));
  return [
    ...problems,
    ...Object.keys(table)
      .filter((id) => !routeIds.has(id))
      .map(
        (id) => `${id} has an operation entry but is not a registered route`,
      ),
  ];
}

function findToolProblems(
  tools: readonly string[],
  mcpTable: McpToolTable,
): string[] {
  const problems = tools.flatMap((tool) => {
    const entry = mcpTable[tool];
    return entry
      ? [describeEntryProblem(entry, `MCP tool ${tool}`)].filter(
          (problem) => problem !== null,
        )
      : [`MCP tool ${tool} has no operation entry`];
  });
  const toolNames = new Set(tools);
  return [
    ...problems,
    ...Object.keys(mcpTable)
      .filter((tool) => !toolNames.has(tool))
      .map(
        (tool) =>
          `${tool} has an operation entry but is not a registered MCP tool`,
      ),
  ];
}

export type CoverageInput = {
  routes: readonly RegisteredRoute[];
  mcpTools: readonly string[];
  table: OperationTable;
  mcpTable: McpToolTable;
};

/**
 * Compares the registered routes and MCP tools with the operation tables. Returns one message per problem,
 * each naming the route or tool; an empty list means zero missing or invalid mappings.
 */
export function findCoverageProblems(input: CoverageInput): string[] {
  return [
    ...findRouteProblems(input.routes, input.table),
    ...findToolProblems(input.mcpTools, input.mcpTable),
    ...findUnknownPermissions(input.table),
    ...findUnknownPermissions(input.mcpTable),
  ];
}
