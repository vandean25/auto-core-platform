import type { CanActivate, ExecutionContext, Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApiKeyAuthGuard } from '../public-api/api-keys/api-key.guard.js';
import { toApiKeyTenantUser } from '../public-api/api-keys/api-key-principal.js';
import { PUBLIC_API_SCOPES } from '../public-api/public-api-scopes.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedUser } from '../auth/types/authenticated-user.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { MCP_SUPERVISOR_READ_TOOL_NAMES } from '../mcp/mcp.constants.js';
import {
  assertMcpTenantAccess,
  isMcpSupervisorRole,
} from '../mcp/mcp.authorization.js';
import { MCP_TOOL_TABLE, OPERATION_TABLE } from './operation-table.js';
import type { LegacyRole } from './operation-types.js';
import { PermissionGuard } from './permission.guard.js';
import { EffectiveCapabilitiesService } from '../common/country-pack/effective-capabilities.guard.js';
import {
  PermissionResolver,
  isMcpToolAllowed,
  type EffectiveAccess,
} from './permission-resolver.js';
import type { RegisteredRoute } from './route-inventory.js';

export type Decision = 'allow' | 'deny';

/** The roles of ADR-0013, a tenant API key, and the synthetic member without a domain role. */
export type MatrixPrincipal = LegacyRole | 'API_KEY' | 'EMPTY_ROLE';

export const MATRIX_PRINCIPALS: readonly MatrixPrincipal[] = [
  'OWNER',
  'ADMIN',
  'TECH',
  'SALES',
  'DEMO',
  'API_KEY',
  'EMPTY_ROLE',
];

/**
 * Product decision for a member without a domain role (AUT-864): session and profile basics plus push
 * device registration and removal; every other route stays 403. The legacy model has no such member,
 * so this list is the expected decision, not a legacy one.
 */
const EMPTY_ROLE_ALLOWED_ROUTES: ReadonlySet<string> = new Set([
  'AuthController.getMe',
  'AuthController.scopeContext',
  'AuthController.logout',
  'AuthController.switchTenant',
  'AuthLocalePreferencesController.getPreferences',
  'AuthLocalePreferencesController.patchPreferences',
  'MeSiteController.listMySites',
  'MeSiteController.setActiveSite',
  'PushController.registerDevice',
  'PushController.revokeDevice',
]);

/**
 * How a row is compared:
 * - guards: the legacy decision is fully made by guards (or the MCP transport), both must be equal.
 * - guards_and_services: protected back-office route. The guards decide the TECH/DEMO denials; the
 *   OWNER/ADMIN/SALES distinctions are made inside the services and are not evaluated here. A guard denial
 *   must stay a denial; a resolver that is stricter than the guards is counted as service-decided.
 * - product_rule: the synthetic empty-role member, compared with the product decision.
 */
export type RowBasis = 'guards' | 'guards_and_services' | 'product_rule';

export type MatrixRow = {
  target: 'route' | 'mcp';
  operation: string;
  kind: string;
  principal: MatrixPrincipal;
  mechanicAccessible: boolean;
  basis: RowBasis;
  legacy: Decision;
  legacyError: string | null;
  resolver: Decision;
  resolverError: string | null;
};

export type MatrixSummary = {
  routes: number;
  mcpTools: number;
  principals: number;
  decisions: number;
  compared: number;
  allows: number;
  denies: number;
  serviceDecided: number;
  diffs: string[];
};

export type MatrixResult = { rows: MatrixRow[]; summary: MatrixSummary };

type Outcome = { decision: Decision; error: string | null };

const TENANT_ID = 'tenant-1';
const MEMBER_UID = 'firebase-uid-1';

function memberUser(principal: MatrixPrincipal): AuthenticatedUser {
  if (principal === 'API_KEY') {
    return toApiKeyTenantUser({
      apiKeyId: 'key-1',
      tenantId: TENANT_ID,
      keyPrefix: 'acp_live_key',
      scopes: PUBLIC_API_SCOPES,
      expiresAt: null,
      revokedAt: null,
      rateLimitPerMinute: 60,
    });
  }
  return {
    userId: MEMBER_UID,
    email: 'member@workshop.at',
    tenantId: TENANT_ID,
    role: principal === 'EMPTY_ROLE' ? '' : principal,
  };
}

function samplePath(route: RegisteredRoute): string {
  return route.path.replace(/:[A-Za-z0-9_]+/g, 'sample');
}

async function decide(run: () => Promise<boolean> | boolean): Promise<Outcome> {
  try {
    return (await run())
      ? { decision: 'allow', error: null }
      : { decision: 'deny', error: 'ForbiddenException' };
  } catch (error) {
    return {
      decision: 'deny',
      error: error instanceof Error ? error.constructor.name : 'Error',
    };
  }
}

function contextOf(route: RegisteredRoute, request: object): ExecutionContext {
  return {
    getClass: () => route.controller,
    getHandler: () => route.handler,
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

/** The guards the app runs today for a route: the global API key and session guards, then the route's own. */
async function buildLegacyGuards(routes: readonly RegisteredRoute[]) {
  const reflector = new Reflector();
  const tenantContext = { setAuthenticatedUser: () => undefined };
  let current: AuthenticatedUser = memberUser('OWNER');
  const jwt = new JwtAuthGuard(
    reflector,
    { authenticateBearerToken: () => Promise.resolve(current) } as never,
    tenantContext as never,
  );
  const apiKey = new ApiKeyAuthGuard(
    reflector,
    {
      verifyToken: () =>
        Promise.resolve({
          apiKeyId: 'key-1',
          tenantId: TENANT_ID,
          keyPrefix: 'acp_live_key',
          scopes: PUBLIC_API_SCOPES,
          expiresAt: null,
          revokedAt: null,
          rateLimitPerMinute: 60,
        }),
      consumeRateLimit: () => Promise.resolve({ allowed: true }),
      touchLastUsed: () => Promise.resolve(),
    } as never,
    tenantContext as never,
    { record: () => Promise.resolve() } as never,
  );
  const routeGuardTypes = [
    ...new Set(routes.flatMap((route) => route.guardTypes)),
  ];
  const moduleRef = await Test.createTestingModule({
    providers: [
      ...routeGuardTypes,
      { provide: Reflector, useValue: reflector },
      { provide: TenantContextService, useValue: tenantContext },
      {
        provide: EffectiveCapabilitiesService,
        useValue: {
          resolve: () =>
            Promise.resolve({
              nova: true,
              pickerl57a: true,
              kaufvertragAt: true,
              willhabenExport: true,
            }),
        },
      },
    ],
  })
    .useMocker(() => ({}))
    .compile();

  return (route: RegisteredRoute, principal: MatrixPrincipal) => {
    current = memberUser(principal);
    const request = {
      method: route.method,
      path: samplePath(route),
      url: samplePath(route),
      query: {},
      body: {},
      headers: {
        authorization:
          principal === 'API_KEY'
            ? 'Bearer acp_live_00000000-0000-0000-0000-000000000000_' +
              '0'.repeat(64)
            : 'Bearer firebase-token',
      },
    };
    const context = contextOf(route, request);
    const chain: CanActivate[] = [
      apiKey,
      jwt,
      ...route.guardTypes.map((type) =>
        moduleRef.get<CanActivate>(type as Type<CanActivate>),
      ),
    ];
    return decide(async () => {
      for (const guard of chain) {
        if (!(await guard.canActivate(context))) {
          return false;
        }
      }
      return true;
    });
  };
}

function buildResolver() {
  let role: LegacyRole | null = null;
  const resolver = new PermissionResolver({
    tenantMember: {
      findFirst: () => Promise.resolve({ role, demo_access_expires_at: null }),
    },
  } as never);
  const guard = new PermissionGuard(resolver);
  return {
    setRole: (next: LegacyRole | null) => {
      role = next;
    },
    guard,
    resolver,
  };
}

function memberRole(principal: MatrixPrincipal): LegacyRole | null {
  return principal === 'API_KEY' || principal === 'EMPTY_ROLE'
    ? null
    : principal;
}

function legacyMcpDecision(tool: string, user: AuthenticatedUser): Outcome {
  try {
    assertMcpTenantAccess(user);
    const role = 'role' in user ? user.role : undefined;
    return (MCP_SUPERVISOR_READ_TOOL_NAMES as readonly string[]).includes(
      tool,
    ) && !isMcpSupervisorRole(role)
      ? { decision: 'deny', error: 'ForbiddenException' }
      : { decision: 'allow', error: null };
  } catch (error) {
    return {
      decision: 'deny',
      error: error instanceof Error ? error.constructor.name : 'Error',
    };
  }
}

function routeBasis(kind: string, principal: MatrixPrincipal): RowBasis {
  if (principal === 'EMPTY_ROLE') {
    return 'product_rule';
  }
  return kind === 'protected' && principal !== 'API_KEY'
    ? 'guards_and_services'
    : 'guards';
}

function emptyRoleExpectation(route: RegisteredRoute, kind: string): Outcome {
  const allowed =
    kind === 'public' ||
    kind === 'mcp_gateway' ||
    EMPTY_ROLE_ALLOWED_ROUTES.has(route.id);
  return allowed
    ? { decision: 'allow', error: null }
    : { decision: 'deny', error: 'ForbiddenException' };
}

async function routeRows(
  routes: readonly RegisteredRoute[],
): Promise<MatrixRow[]> {
  const legacyOf = await buildLegacyGuards(routes);
  const { guard, setRole } = buildResolver();
  const rows: MatrixRow[] = [];
  for (const route of routes) {
    const kind = OPERATION_TABLE[route.id]?.kind ?? 'unmapped';
    for (const principal of MATRIX_PRINCIPALS) {
      setRole(memberRole(principal));
      const request = {
        method: route.method,
        path: samplePath(route),
        url: samplePath(route),
        user: memberUser(principal),
      };
      const resolver = await decide(() =>
        guard.canActivate(contextOf(route, request)),
      );
      const legacy =
        principal === 'EMPTY_ROLE'
          ? emptyRoleExpectation(route, kind)
          : await legacyOf(route, principal);
      rows.push({
        target: 'route',
        operation: route.id,
        kind,
        principal,
        mechanicAccessible: route.mechanicAccessible,
        basis: routeBasis(kind, principal),
        legacy: legacy.decision,
        legacyError: legacy.error,
        resolver: resolver.decision,
        resolverError: resolver.error,
      });
    }
  }
  return rows;
}

function toolRow(
  tool: string,
  principal: MatrixPrincipal,
  access: EffectiveAccess | null,
): MatrixRow {
  const legacy: Outcome =
    principal === 'EMPTY_ROLE'
      ? { decision: 'deny', error: 'ForbiddenException' }
      : legacyMcpDecision(tool, memberUser(principal));
  return {
    target: 'mcp',
    operation: tool,
    kind: MCP_TOOL_TABLE[tool]?.kind ?? 'unmapped',
    principal,
    mechanicAccessible: false,
    basis: principal === 'EMPTY_ROLE' ? 'product_rule' : 'guards',
    legacy: legacy.decision,
    legacyError: legacy.error,
    resolver: isMcpToolAllowed(tool, access) ? 'allow' : 'deny',
    resolverError: null,
  };
}

async function toolRows(tools: readonly string[]): Promise<MatrixRow[]> {
  const { resolver, setRole } = buildResolver();
  const rows: MatrixRow[] = [];
  for (const tool of tools) {
    for (const principal of MATRIX_PRINCIPALS) {
      setRole(memberRole(principal));
      const access =
        principal === 'API_KEY'
          ? null
          : await resolver.resolve(
              {},
              { userId: MEMBER_UID, tenantId: TENANT_ID },
            );
      rows.push(toolRow(tool, principal, access));
    }
  }
  return rows;
}

type Verdict = 'equal' | 'service_decided' | 'diff';

function judge(row: MatrixRow): Verdict {
  if (row.legacy === row.resolver) {
    return 'equal';
  }
  return row.basis === 'guards_and_services' &&
    row.legacy === 'allow' &&
    row.resolver === 'deny'
    ? 'service_decided'
    : 'diff';
}

function summarize(
  rows: readonly MatrixRow[],
  routes: number,
  mcpTools: number,
): MatrixSummary {
  const verdicts = rows.map((row) => [row, judge(row)] as const);
  const compared = verdicts.filter(
    ([, verdict]) => verdict !== 'service_decided',
  );
  return {
    routes,
    mcpTools,
    principals: MATRIX_PRINCIPALS.length,
    decisions: rows.length,
    compared: compared.length,
    allows: compared.filter(([row]) => row.legacy === 'allow').length,
    denies: compared.filter(([row]) => row.legacy === 'deny').length,
    serviceDecided: verdicts.length - compared.length,
    diffs: verdicts
      .filter(([, verdict]) => verdict === 'diff')
      .map(
        ([row]) =>
          `${row.principal} ${row.target} ${row.operation} (${row.kind}): legacy ${row.legacy}, resolver ${row.resolver}`,
      ),
  };
}

/**
 * Evaluates every route and MCP tool for every principal twice: with the guards the app runs today
 * (global API key and session guards, the route guards read from controller metadata, the MCP transport
 * and supervisor rules) and with the resolver behind PermissionGuard. Fixtures are identical for both sides:
 * one tenant, one member, one membership row per role.
 */
export async function runDecisionMatrix(
  routes: readonly RegisteredRoute[],
  mcpTools: readonly string[],
): Promise<MatrixResult> {
  // The worker guards read the shared secret. A member session never carries it, so they refuse it.
  const previous = process.env.CLOUD_TASKS_WORKER_SECRET;
  process.env.CLOUD_TASKS_WORKER_SECRET = 'matrix-worker-secret';
  try {
    const rows = [...(await routeRows(routes)), ...(await toolRows(mcpTools))];
    return { rows, summary: summarize(rows, routes.length, mcpTools.length) };
  } finally {
    if (previous === undefined) {
      delete process.env.CLOUD_TASKS_WORKER_SECRET;
    } else {
      process.env.CLOUD_TASKS_WORKER_SECRET = previous;
    }
  }
}

export function formatMatrixSummary(summary: MatrixSummary): string {
  return [
    `decision matrix: ${summary.routes} routes + ${summary.mcpTools} MCP tools x ${summary.principals} principals = ${summary.decisions} decisions;`,
    `${summary.compared} compared (${summary.allows} allow, ${summary.denies} deny),`,
    `${summary.serviceDecided} left to the service contract tests of 1c/1d,`,
    `${summary.diffs.length} diffs`,
  ].join(' ');
}
