import { Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { AllowPlatformAdmin } from '../common/decorators/allow-platform-admin.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { CloudTasksWorkerGuard } from '../common/guards/cloud-tasks-worker.guard.js';
import { InteractiveUserGuard } from '../auth/guards/interactive-user.guard.js';
import { SuperAdminGuard } from '../auth/super-admin.guard.js';
import { ApiRootModule } from '../api-root.module.js';
import { RequirePublicApiScope } from '../public-api/decorators/require-public-api-scope.decorator.js';
import { isDemoMutationAllowed } from '../landing-demo-access/demo-role-restrictions.js';
import { MCP_TOOL_TABLE, OPERATION_TABLE } from './operation-table.js';
import { findCoverageProblems } from './permission-coverage.js';
import {
  listRegisteredMcpTools,
  listRegisteredRoutes,
} from './route-inventory.js';
import type { OperationEntry } from './operation-types.js';

@Controller('fixture-permissions')
class FixtureController {
  @Get('unmapped')
  unmapped() {
    return null;
  }

  @Public()
  @Get('public')
  publicRoute() {
    return null;
  }

  @UseGuards(InteractiveUserGuard)
  @Get('session')
  sessionRoute() {
    return null;
  }

  @AllowPlatformAdmin()
  @UseGuards(SuperAdminGuard)
  @Get('platform')
  platformRoute() {
    return null;
  }

  @Public()
  @UseGuards(CloudTasksWorkerGuard)
  @Post('job')
  serviceJobRoute() {
    return null;
  }

  @RequirePublicApiScope('customers:read')
  @Get('api-key')
  apiKeyRoute() {
    return null;
  }
}

@Module({ imports: [ApiRootModule], controllers: [FixtureController] })
class FixtureRootModule {}

const FIXTURE_NON_TENANT_ENTRIES = {
  'FixtureController.publicRoute': { kind: 'public', policy: 'fixture' },
  'FixtureController.sessionRoute': { kind: 'session', policy: 'fixture' },
  'FixtureController.platformRoute': {
    kind: 'platform_admin',
    policy: 'fixture',
  },
  'FixtureController.serviceJobRoute': {
    kind: 'service_job',
    policy: 'fixture',
  },
  'FixtureController.apiKeyRoute': {
    kind: 'api_key',
    policy: 'fixture',
    apiKeyScope: 'customers:read',
    permissions: ['customer.read'],
  },
} as const satisfies Record<string, OperationEntry>;

const FIXTURE_MCP_TOOL = 'fixture_unmapped_tool';

describe('permission coverage', () => {
  const realRoutes = listRegisteredRoutes(ApiRootModule);
  const fixtureRoutes = listRegisteredRoutes(FixtureRootModule).filter(
    (route) => route.id.startsWith('FixtureController.'),
  );

  it('maps every registered route and MCP tool of the real app (zero missing or invalid)', async () => {
    const mcpTools = await listRegisteredMcpTools();

    expect(realRoutes.length).toBeGreaterThan(400);
    expect(mcpTools.length).toBeGreaterThan(50);
    expect(
      findCoverageProblems({
        routes: realRoutes,
        mcpTools,
        table: OPERATION_TABLE,
        mcpTable: MCP_TOOL_TABLE,
      }),
    ).toEqual([]);
  });

  it('fails an unmapped route and names it', () => {
    const problems = findCoverageProblems({
      routes: [...realRoutes, ...fixtureRoutes],
      mcpTools: [],
      table: { ...OPERATION_TABLE, ...FIXTURE_NON_TENANT_ENTRIES },
      mcpTable: {},
    });

    expect(problems).toEqual([
      expect.stringContaining('GET /api/fixture-permissions/unmapped'),
    ]);
    expect(problems[0]).toContain('FixtureController.unmapped');
  });

  it('fails an unmapped MCP tool and names it', async () => {
    const mcpTools = await listRegisteredMcpTools((server) => {
      server.registerTool(FIXTURE_MCP_TOOL, {}, () => ({ content: [] }));
    });

    const problems = findCoverageProblems({
      routes: [],
      mcpTools,
      table: {},
      mcpTable: MCP_TOOL_TABLE,
    });

    expect(problems).toEqual([expect.stringContaining(FIXTURE_MCP_TOOL)]);
  });

  it.each(Object.keys(FIXTURE_NON_TENANT_ENTRIES))(
    'passes classified non-tenant route %s only with an explicit policy entry',
    (routeId) => {
      const route = fixtureRoutes.filter((r) => r.id === routeId);
      const table = {
        [routeId]:
          FIXTURE_NON_TENANT_ENTRIES[
            routeId as keyof typeof FIXTURE_NON_TENANT_ENTRIES
          ],
      };

      expect(
        findCoverageProblems({
          routes: route,
          mcpTools: [],
          table,
          mcpTable: {},
        }),
      ).toEqual([]);
      expect(
        findCoverageProblems({
          routes: route,
          mcpTools: [],
          table: {},
          mcpTable: {},
        }),
      ).toEqual([expect.stringContaining(routeId)]);
    },
  );

  it('rejects a classification that contradicts the route metadata', () => {
    const route = fixtureRoutes.filter(
      (r) => r.id === 'FixtureController.publicRoute',
    );

    expect(
      findCoverageProblems({
        routes: route,
        mcpTools: [],
        table: {
          'FixtureController.publicRoute': {
            kind: 'platform_admin',
            policy: 'fixture',
          },
        },
        mcpTable: {},
      }),
    ).toEqual([expect.stringContaining('FixtureController.publicRoute')]);
  });

  it('records legacy access that respects the global TECH and DEMO restrictions', () => {
    const byId = new Map(realRoutes.map((route) => [route.id, route]));
    const violations: string[] = [];

    for (const [id, entry] of Object.entries(OPERATION_TABLE)) {
      const route = byId.get(id);
      if (entry.kind !== 'protected' || !route) {
        continue;
      }
      if (entry.legacy.includes('TECH') && !route.mechanicAccessible) {
        violations.push(`${id}: TECH listed but route is not mechanic-accessible`);
      }
      if (
        entry.legacy.includes('DEMO') &&
        !isDemoMutationAllowed(route.method, route.path.replace(/:\w+/g, 'x'))
      ) {
        violations.push(`${id}: DEMO listed but the demo restriction blocks it`);
      }
    }

    expect(violations).toEqual([]);
  });
});
