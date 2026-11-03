import type { PublicApiScope } from '../public-api/public-api-scopes.js';
import type { PermissionId } from './permission-catalogue.js';
import type {
  ApiKeyOperation,
  ClassifiedOperation,
  DomainCheck,
  LegacyRole,
  McpToolOperation,
  OperationScope,
  ProtectedOperation,
} from './operation-types.js';

/** Legacy role sets. TECH and DEMO appear only where the global restrictions or the service let them through. */
export const ADMINS: readonly LegacyRole[] = ['OWNER', 'ADMIN'];
export const BACK_OFFICE: readonly LegacyRole[] = ['OWNER', 'ADMIN', 'SALES'];
export const BACK_OFFICE_DEMO: readonly LegacyRole[] = [...BACK_OFFICE, 'DEMO'];
export const BACK_OFFICE_TECH: readonly LegacyRole[] = [...BACK_OFFICE, 'TECH'];
export const EVERY_ROLE: readonly LegacyRole[] = [
  ...BACK_OFFICE,
  'TECH',
  'DEMO',
];
export const TECH_ONLY: readonly LegacyRole[] = ['TECH'];

type PermissionSet = PermissionId | readonly PermissionId[];

const toList = (permissions: PermissionSet): readonly PermissionId[] =>
  typeof permissions === 'string' ? [permissions] : permissions;

/** A protected operation for a signed-in tenant member. */
export function op(
  permissions: PermissionSet,
  legacy: readonly LegacyRole[],
  scope: OperationScope,
  checks: readonly DomainCheck[] = [],
): ProtectedOperation {
  return {
    kind: 'protected',
    permissions: toList(permissions),
    legacy,
    scope,
    checks,
    principals: ['USER'],
  };
}

/** A protected operation for an MCP agent acting for a tenant member. */
export function mcpTool(
  permissions: PermissionSet,
  legacy: readonly LegacyRole[],
  scope: OperationScope,
  checks: readonly DomainCheck[] = [],
  selectedByInput = false,
): McpToolOperation {
  return {
    ...op(permissions, legacy, scope, checks),
    principals: ['MCP_AGENT'],
    ...(selectedByInput ? { selectedByInput: true } : {}),
  };
}

export function classified(
  kind: ClassifiedOperation['kind'],
  policy: string,
  legacy?: readonly LegacyRole[],
): ClassifiedOperation {
  return legacy ? { kind, policy, legacy } : { kind, policy };
}

export function apiKey(
  apiKeyScope: PublicApiScope,
  permission: PermissionId,
  policy: string,
): ApiKeyOperation {
  return { kind: 'api_key', policy, apiKeyScope, permissions: [permission] };
}
