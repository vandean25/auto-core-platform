import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  CapabilityGuard,
  RequireCapability,
} from '../common/country-pack/effective-capabilities.guard.js';
import {
  GATED_TOOLS,
  buildHarness,
  connectClient,
  listedToolNames,
} from './mcp-capability-gate.spec.support.js';

describe('MCP capability gate (AUT-913)', () => {
  // Regression: the MCP tools kept answering after the tenant switched the capability off.
  describe.each(GATED_TOOLS)('%s', (tool, capability, args) => {
    it(`is listed and answers when ${capability} is on`, async () => {
      const harness = buildHarness({ [capability]: true });
      const client = await connectClient(harness);

      expect(await listedToolNames(client)).toContain(tool);
      const result = await client.callTool({ name: tool, arguments: args });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toBeDefined();
    });

    it.each([
      ['off', { [capability]: false }],
      ['null (not configured)', null],
    ])(
      `is hidden and refused with CAPABILITY_UNAVAILABLE when ${capability} is %s`,
      async (_label, capabilities) => {
        const harness = buildHarness(capabilities);
        const client = await connectClient(harness);

        expect(await listedToolNames(client)).not.toContain(tool);
        const result = await client.callTool({ name: tool, arguments: args });

        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain(
          'CAPABILITY_UNAVAILABLE',
        );
        expect(harness.vehicles.getPickerlDueData).not.toHaveBeenCalled();
        expect(harness.nova.calculate).not.toHaveBeenCalled();
      },
    );
  });

  it('keeps the tools that no capability gates in the list when both capabilities are off', async () => {
    const client = await connectClient(
      buildHarness({ pickerl57a: false, nova: false }),
    );

    const names = await listedToolNames(client);

    expect(names).toContain('get_revenue_report');
    expect(names).not.toContain('list_pickerl_due');
    expect(names).not.toContain('get_nova_preview');
  });

  // Regression: MCP must refuse exactly where the REST CapabilityGuard refuses, including null.
  it.each([
    ['on', { pickerl57a: true }, false],
    ['off', { pickerl57a: false }, true],
    ['null', null, true],
  ])(
    'refuses like the REST guard when pickerl57a is %s',
    async (_label, capabilities, refused) => {
      const { capabilities: effective, gate } = buildHarness(capabilities);
      class RestProbe {
        @RequireCapability('pickerl57a')
        handler(): void {}
      }
      const context = {
        getHandler: () => RestProbe.prototype.handler,
        getClass: () => RestProbe,
        switchToHttp: () => ({ getRequest: () => ({ query: {} }) }),
      } as unknown as ExecutionContext;
      const restGuard = new CapabilityGuard(new Reflector(), effective);

      const rest = await restGuard
        .canActivate(context)
        .catch((e: unknown) => e);
      const mcp = await gate
        .assertAvailable('pickerl57a')
        .catch((e: unknown) => e);

      expect(rest === true).toBe(!refused);
      expect(mcp === undefined).toBe(!refused);
      if (refused) {
        expect(mcp).toBeInstanceOf(ForbiddenException);
        expect((mcp as ForbiddenException).getStatus()).toBe(
          (rest as ForbiddenException).getStatus(),
        );
        expect((mcp as ForbiddenException).getResponse()).toMatchObject({
          code: ((rest as ForbiddenException).getResponse() as { code: string })
            .code,
        });
      }
    },
  );
});
