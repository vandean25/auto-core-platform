import { appendWave2ReadCapabilities } from './mcp-read-wave2-capabilities.js';
import type { McpCapability } from './mcp-capabilities.service.js';

describe('appendWave2ReadCapabilities', () => {
  const base: McpCapability[] = [];

  it('lists get_staff_availability as disabled for SALES', () => {
    const tools = appendWave2ReadCapabilities(base, 'SALES');
    const staff = tools.find((tool) => tool.tool === 'get_staff_availability');
    expect(staff).toEqual({
      tool: 'get_staff_availability',
      description: expect.any(String),
      tier: 'AUTO',
      access: 'read',
      enabled: false,
      disabled_reason: 'role_not_permitted',
    });
  });

  it('keeps get_staff_availability enabled for OWNER', () => {
    const tools = appendWave2ReadCapabilities(base, 'OWNER');
    expect(tools.find((tool) => tool.tool === 'get_staff_availability')).toMatchObject({
      enabled: true,
    });
  });
});
