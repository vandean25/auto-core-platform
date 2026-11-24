import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service.js';
import { PdfWorkerController } from './pdf-worker.controller.js';
import { PdfWorkerModule } from './pdf-worker.module.js';

function collectModuleGraph(rootModule: Type<unknown>): {
  modules: Set<Type<unknown>>;
  controllers: Set<Type<unknown>>;
} {
  const modules = new Set<Type<unknown>>();
  const controllers = new Set<Type<unknown>>();
  const queue: Type<unknown>[] = [rootModule];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || modules.has(current)) {
      continue;
    }
    modules.add(current);

    const moduleControllers =
      (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, current) as
        | Type<unknown>[]
        | undefined) ?? [];
    for (const controller of moduleControllers) {
      controllers.add(controller);
    }

    const imports =
      (Reflect.getMetadata(MODULE_METADATA.IMPORTS, current) as
        | Array<Type<unknown> | { module?: Type<unknown> }>
        | undefined) ?? [];
    for (const imported of imports) {
      const target =
        typeof imported === 'function' ? imported : imported?.module;
      if (target && !modules.has(target)) {
        queue.push(target);
      }
    }
  }

  return { modules, controllers };
}

function collectControllerRoutes(controller: Type<unknown>): string[] {
  const prefixRaw =
    (Reflect.getMetadata(PATH_METADATA, controller) as string | undefined) ??
    '';
  const prefix = prefixRaw.replace(/^\/+|\/+$/g, '');
  const routes: string[] = [];

  for (const key of Object.getOwnPropertyNames(controller.prototype)) {
    if (key === 'constructor') continue;
    const descriptor = Object.getOwnPropertyDescriptor(
      controller.prototype,
      key,
    );
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const methodPath = Reflect.getMetadata(PATH_METADATA, descriptor.value) as
      | string
      | undefined;
    if (methodPath === undefined) continue;

    const cleanMethodPath = methodPath.replace(/^\/+|\/+$/g, '');
    const fullPath = [prefix, cleanMethodPath].filter(Boolean).join('/');
    routes.push(`/${fullPath}`);
  }

  return routes;
}

describe('PDF worker bootstrap module graph and lazy Sentry (AUT-1038)', () => {
  it('WHEN the worker module graph is inspected THEN it never imports ApiRootModule, AppModule, AuthModule, or unrelated API feature modules', () => {
    const { modules } = collectModuleGraph(PdfWorkerModule);
    const moduleNames = [...modules].map((mod) => mod.name);

    const forbiddenModules = [
      'ApiRootModule',
      'AppModule',
      'AuthModule',
      'DashboardRealtimeModule',
      'InventoryModule',
      'PurchaseModule',
      'SalesModule',
      'CustomerModule',
      'WorkshopModule',
      'InvoicesModule',
      'CreditNotesModule',
      'WarrantyClaimModule',
      'VehicleStockModule',
      'DocumentBrandingModule',
      'McpModule',
      'SchedulerModule',
      'CanonicalMigrationImportModule',
      'PublicApiModule',
      'PlatformAdminModule',
    ];

    for (const forbidden of forbiddenModules) {
      expect(moduleNames).not.toContain(forbidden);
    }
  });

  it('WHEN the worker controllers are inspected THEN only /health and */worker routes are registered', () => {
    const { controllers } = collectModuleGraph(PdfWorkerModule);
    const routes = [...controllers].flatMap((controller) =>
      collectControllerRoutes(controller),
    );

    expect(routes).toContain('/health');
    expect(routes).toContain('/invoices/:id/pdf/worker');
    expect(routes).toContain('/credit-notes/:id/pdf/worker');
    expect(routes).toContain('/workshop/orders/:id/pdf/worker');
    expect(routes).toContain('/workshop/estimates/:id/pdf/worker');
    expect(routes).toContain(
      '/workshop/orders/:orderId/warranty-claims/:id/pdf/worker',
    );
    expect(routes).toContain('/vehicle-sales/:id/kaufvertrag/pdf/worker');

    for (const route of routes) {
      const isHealth = route === '/health';
      const isWorkerRoute = route.endsWith('/worker');
      expect(isHealth || isWorkerRoute).toBe(true);
    }
  });

  it('WHEN worker-main.ts is inspected THEN it bootstraps PdfWorkerModule and loads Sentry lazily after startup', () => {
    const workerMainPath = join(import.meta.dirname, '../worker-main.ts');
    const source = readFileSync(workerMainPath, 'utf8');

    expect(source).not.toMatch(/^import\s+['"]\.\/instrument\.js['"]/m);
    expect(source).not.toMatch(/ApiRootModule/);
    expect(source).not.toMatch(/AppModule/);
    expect(source).toContain('PdfWorkerModule');
    expect(source).toMatch(/import\(['"]\.\/instrument\.js['"]\)/);
  });

  it('WHEN PdfWorkerModule is compiled THEN all worker controllers and dependencies resolve without missing providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PdfWorkerModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const controller = moduleRef.get(PdfWorkerController);
    expect(controller).toBeInstanceOf(PdfWorkerController);
    await moduleRef.close();
  });
});
