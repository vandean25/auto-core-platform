import { listCapabilitiesForRole } from '../mcp/mcp-capabilities.service.spec.support.js';
import { MCP_ALLOWED_TENANT_ROLES } from '../mcp/mcp.authorization.js';
import { MCP_TOOL_NAMES_WITH_WAVE2 } from '../mcp/mcp-read-wave2-catalog.js';
import type { LegacyRole } from './operation-types.js';
import { isMcpToolAllowed, legacyAccess } from './permission-resolver.js';
import { listRegisteredMcpTools } from './route-inventory.js';

const MCP_SESSION_ROLES = [...MCP_ALLOWED_TENANT_ROLES] as LegacyRole[];

const PARITY_CASES = MCP_TOOL_NAMES_WITH_WAVE2.flatMap((tool) =>
  MCP_SESSION_ROLES.map((role) => ({ tool, role })),
);

const hiddenKey = (role: string, tool: string) => `${role}:${tool}`;

/**
 * AUT-912: a tool `get_capabilities` hides from a role must also be refused when that role calls it
 * by name, so the catalog and the permission entry gate every tool by the same roles.
 */
describe('MCP tool role gating: capabilities catalog vs permission entry', () => {
  const roleHidden = new Map<string, boolean>();

  beforeAll(async () => {
    for (const role of MCP_SESSION_ROLES) {
      for (const row of await listCapabilitiesForRole(role)) {
        roleHidden.set(
          hiddenKey(role, row.tool),
          row.disabled_reason === 'role_not_permitted',
        );
      }
    }
  });

  it('gates the catalogued tools exactly as the MCP server registers them', async () => {
    expect(await listRegisteredMcpTools()).toEqual(
      [...MCP_TOOL_NAMES_WITH_WAVE2].sort(),
    );
  });

  it.each(PARITY_CASES)(
    'hides $tool from $role in the catalog only when the permission entry refuses that role',
    ({ tool, role }) => {
      expect(isMcpToolAllowed(tool, legacyAccess(role))).toBe(
        !roleHidden.get(hiddenKey(role, tool)),
      );
    },
  );
});
