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

function describeEntryProblem(
  entry: OperationEntry | ClassifiedOperation,
): string | null {
  if (entry.kind === 'protected') {
    if (entry.permissions.length === 0) {
      return 'has no permission';
    }
    if (entry.legacy.length === 0 || entry.principals.length === 0) {
      return 'records no legacy access or principal';
    }
    return null;
  }
  if (entry.kind === 'api_key' && entry.permissions.length === 0) {
    return 'has no permission';
  }
  return entry.policy.trim() === '' ? 'has no policy text' : null;
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
  const { routes, mcpTools, table, mcpTable } = input;
  const problems: string[] = [];

  for (const route of routes) {
    const where = `${route.method} ${route.path} (${route.id})`;
    const entry = table[route.id];
    if (!entry) {
      problems.push(`${where} has no operation entry`);
      continue;
    }
    const allowed = allowedKinds(route);
    if (!allowed.includes(entry.kind)) {
      problems.push(
        `${where} is classified as ${entry.kind} but its metadata requires ${allowed.join(' or ')}`,
      );
    }
    if (
      entry.kind === 'api_key' &&
      entry.apiKeyScope !== route.publicApiScope
    ) {
      problems.push(`${where} maps API key scope ${entry.apiKeyScope}`);
    }
    const problem = describeEntryProblem(entry);
    if (problem) {
      problems.push(`${where} ${problem}`);
    }
  }

  const routeIds = new Set(routes.map((route) => route.id));
  for (const id of Object.keys(table)) {
    if (!routeIds.has(id)) {
      problems.push(
        `${id} has an operation entry but is not a registered route`,
      );
    }
  }

  for (const tool of mcpTools) {
    const entry = mcpTable[tool];
    if (!entry) {
      problems.push(`MCP tool ${tool} has no operation entry`);
      continue;
    }
    const problem = describeEntryProblem(entry);
    if (problem) {
      problems.push(`MCP tool ${tool} ${problem}`);
    }
  }
  const toolNames = new Set(mcpTools);
  for (const tool of Object.keys(mcpTable)) {
    if (!toolNames.has(tool)) {
      problems.push(
        `${tool} has an operation entry but is not a registered MCP tool`,
      );
    }
  }

  return [
    ...problems,
    ...findUnknownPermissions(table),
    ...findUnknownPermissions(mcpTable),
  ];
}
