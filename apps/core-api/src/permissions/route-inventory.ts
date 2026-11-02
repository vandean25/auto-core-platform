import 'reflect-metadata';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import {
  RequestMethod,
  type DynamicModule,
  type ForwardReference,
  type Type,
} from '@nestjs/common';
import { MetadataScanner } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ALLOW_PLATFORM_ADMIN_KEY } from '../common/decorators/allow-platform-admin.decorator.js';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator.js';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { createMcpServerWithWave2Reads } from '../mcp/mcp-server.factory.wave2.js';
import type { McpToolHandlerWave2Wrapper } from '../mcp/mcp-tool-handler.wave2-wrapper.js';
import { PUBLIC_API_SCOPE_KEY } from '../public-api/decorators/require-public-api-scope.decorator.js';

/** Set by `app.setGlobalPrefix('api')` in main.ts. */
const GLOBAL_PREFIX = 'api';

export type RegisteredRoute = {
  /** Operation table key: controller class name and handler name. */
  id: string;
  method: string;
  /** Full path including the global prefix, for reports and for the demo restriction. */
  path: string;
  guards: readonly string[];
  isPublic: boolean;
  mechanicAccessible: boolean;
  allowPlatformAdmin: boolean;
  publicApiScope: string | null;
};

type ModuleRef =
  Type<unknown> | DynamicModule | ForwardReference<() => Type<unknown>>;

function resolveModule(ref: ModuleRef): {
  module: Type<unknown>;
  dynamic: DynamicModule | null;
} {
  if (typeof ref === 'function') {
    return { module: ref, dynamic: null };
  }
  return 'forwardRef' in ref
    ? resolveModule(ref.forwardRef())
    : { module: ref.module, dynamic: ref };
}

/** Decorator metadata of a class or method, typed by the caller. */
function metadata<T>(key: string, target: object): T | undefined {
  return Reflect.getMetadata(key, target) as T | undefined;
}

function moduleParts(ref: ModuleRef): {
  module: Type<unknown>;
  controllers: Type<unknown>[];
  imports: ModuleRef[];
} {
  const { module, dynamic } = resolveModule(ref);
  const extra = dynamic ?? { controllers: [], imports: [] };
  return {
    module,
    controllers: [
      ...(metadata<Type<unknown>[]>(MODULE_METADATA.CONTROLLERS, module) ?? []),
      ...(extra.controllers as Type<unknown>[]),
    ],
    imports: [
      ...(metadata<ModuleRef[]>(MODULE_METADATA.IMPORTS, module) ?? []),
      ...(extra.imports as ModuleRef[]),
    ],
  };
}

/** Controllers of every module reachable from the root through static and dynamic imports. */
function collectControllers(root: ModuleRef): Type<unknown>[] {
  const seen = new Set<Type<unknown>>();
  const controllers = new Set<Type<unknown>>();
  const pending: ModuleRef[] = [root];
  for (let ref = pending.pop(); ref; ref = pending.pop()) {
    const parts = moduleParts(ref);
    if (!seen.has(parts.module)) {
      seen.add(parts.module);
      parts.controllers.forEach((controller) => controllers.add(controller));
      pending.push(...parts.imports);
    }
  }
  return [...controllers];
}

function joinPath(...parts: string[]): string {
  return `/${parts.join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1');
}

function pathsOf(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : [value].flat();
}

/** Same lookup as the Reflector's getAllAndOverride([handler, class]): the handler wins over the class. */
function readMetadata<T>(
  key: string,
  handler: object,
  controller: Type<unknown>,
): T | undefined {
  return metadata<T>(key, handler) ?? metadata<T>(key, controller);
}

function guardNames(handler: object, controller: Type<unknown>): string[] {
  return [controller, handler].flatMap((target) =>
    (metadata<{ name: string }[]>(GUARDS_METADATA, target) ?? []).map(
      (guard) => guard.name,
    ),
  );
}

/** Every HTTP route Nest registers for the modules reachable from `root`, read from controller metadata. */
export function listRegisteredRoutes(root: ModuleRef): RegisteredRoute[] {
  const scanner = new MetadataScanner();
  return collectControllers(root).flatMap((controller) => {
    const prototype = controller.prototype as Record<string, object>;
    const prefixes = pathsOf(
      metadata<string | string[]>(PATH_METADATA, controller),
    );
    return scanner.getAllMethodNames(prototype).flatMap((name) => {
      const handler = prototype[name];
      const method = metadata<RequestMethod>(METHOD_METADATA, handler);
      if (method === undefined) {
        return [];
      }
      const subPaths = pathsOf(
        metadata<string | string[]>(PATH_METADATA, handler),
      );
      return prefixes.flatMap((prefix) =>
        subPaths.map((subPath) => ({
          id: `${controller.name}.${name}`,
          method: RequestMethod[method],
          path: joinPath(GLOBAL_PREFIX, prefix, subPath),
          guards: guardNames(handler, controller),
          isPublic:
            readMetadata<boolean>(IS_PUBLIC_KEY, handler, controller) ?? false,
          mechanicAccessible:
            readMetadata<boolean>(
              MECHANIC_ACCESSIBLE_KEY,
              handler,
              controller,
            ) ?? false,
          allowPlatformAdmin:
            readMetadata<boolean>(
              ALLOW_PLATFORM_ADMIN_KEY,
              handler,
              controller,
            ) ?? false,
          publicApiScope:
            readMetadata<string>(PUBLIC_API_SCOPE_KEY, handler, controller) ??
            null,
        })),
      );
    });
  });
}

/**
 * Names of the tools the live MCP server registers, read through the protocol (`tools/list`)
 * rather than from the tool-name constants. `extend` lets a test register an additional tool.
 */
export async function listRegisteredMcpTools(
  extend?: (server: McpServer) => void,
): Promise<string[]> {
  // The handler is only called when a tool runs; listing tools never does.
  const idleHandler = {} as McpToolHandlerWave2Wrapper;
  const server = createMcpServerWithWave2Reads(idleHandler, {
    agentId: 'permission-inventory',
    onBehalfOfUserId: 'permission-inventory',
  });
  extend?.(server);
  const client = new Client({ name: 'permission-inventory', version: '1.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  try {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor });
      names.push(...page.tools.map((tool) => tool.name));
      cursor = page.nextCursor;
    } while (cursor);
    return names.sort();
  } finally {
    await client.close();
    await server.close();
  }
}
