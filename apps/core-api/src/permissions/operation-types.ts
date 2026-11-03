import type { PublicApiScope } from '../public-api/public-api-scopes.js';
import type { PermissionId } from './permission-catalogue.js';

/** Tenant member roles of ADR-0013. Recorded as the legacy effective access of an operation. */
export type LegacyRole = 'OWNER' | 'ADMIN' | 'TECH' | 'SALES' | 'DEMO';

/** Who may call: a signed-in tenant member, a tenant API key (ADR-0026) or an MCP agent acting for a member. */
export type PrincipalType = 'USER' | 'API_KEY' | 'MCP_AGENT';

/** tenant: tenant-wide data. site: active-site data (ADR-0022). self: the caller's own record. */
export type OperationScope = 'tenant' | 'site' | 'self';

/** Checks a granted permission never replaces (ADR-0034 section 2). */
export type DomainCheck =
  | 'employee_identity'
  | 'task_assignment'
  | 'fiscal_lock'
  | 'site_membership'
  | 'document_site'
  | 'business_state'
  | 'own_record'
  | 'agent_policy';

/** A protected domain operation. Resolved from the tenant member's permissions. */
export type ProtectedOperation = {
  kind: 'protected';
  permissions: readonly PermissionId[];
  legacy: readonly LegacyRole[];
  scope: OperationScope;
  checks: readonly DomainCheck[];
  principals: readonly PrincipalType[];
  /** The listed permissions are alternatives; the request input (such as a document type) selects which one applies. */
  selectedByInput?: true;
};

/** Routes outside tenant-role authorization. Each has its own policy and is never treated as a tenant member. */
export type ClassifiedOperation = {
  kind: 'public' | 'session' | 'platform_admin' | 'service_job' | 'mcp_gateway';
  policy: string;
  /** Legacy effective access, recorded for session routes whose roles the global restrictions decide. */
  legacy?: readonly LegacyRole[];
  /** A session route a member without a domain role may still call (own session or context selection). */
  withoutRole?: true;
};

/** A route a tenant API key may call. The scope is the public-API allow-list; permissions are catalogue mapping only. */
export type ApiKeyOperation = {
  kind: 'api_key';
  policy: string;
  apiKeyScope: PublicApiScope;
  permissions: readonly PermissionId[];
  /** Roles of a signed-in member who calls the route with a session instead of a key (the global restrictions decide). */
  legacy: readonly LegacyRole[];
};

export type OperationEntry =
  ProtectedOperation | ClassifiedOperation | ApiKeyOperation;

/** An MCP tool is a protected operation for the MCP agent principal; the pipeline applies the agent policy on top. */
export type McpToolOperation = ProtectedOperation & {
  principals: readonly ['MCP_AGENT'];
};

export type OperationTable = Readonly<Record<string, OperationEntry>>;
export type McpToolTable = Readonly<
  Record<string, McpToolOperation | ClassifiedOperation>
>;
