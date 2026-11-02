import 'reflect-metadata';
import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MECHANIC_ACCESSIBLE_KEY } from '../common/decorators/mechanic-accessible.decorator.js';
import { DRY_RUN_SUPPORTED_KEY } from '../dry-run/dry-run.constants.js';
import { VehicleValuationController } from './vehicle-valuation.controller.js';
import { VehicleModule } from './vehicle.module.js';

describe('VehicleValuationController NoVA calculation', () => {
  it('delegates the calculate request to the NoVA service', async () => {
    const request = { netPriceEuro: 20_000, vehicleId: 'vehicle-1' };
    const response = { novaAmountEuro: 1200 };
    const novaCalculationService = {
      calculate: jest.fn().mockResolvedValue(response),
    };
    const controller = new VehicleValuationController(
      {} as never,
      novaCalculationService as never,
    );

    await expect(controller.calculateNova(request)).resolves.toBe(response);
    expect(novaCalculationService.calculate).toHaveBeenCalledWith(request);
  });

  it('documents vehicle and explicit-input request modes', () => {
    const parameters = Reflect.getMetadata(
      'swagger/apiParameters',
      VehicleValuationController.prototype.calculateNova,
    ) as Array<{
      in: string;
      schema?: {
        anyOf?: Array<{
          allOf: Array<{
            required?: string[];
            properties?: Record<string, unknown>;
          }>;
        }>;
      };
    }>;
    const bodySchema = parameters.find((parameter) => parameter.in === 'body')
      ?.schema;

    expect(bodySchema?.anyOf).toHaveLength(3);
    expect(bodySchema?.anyOf?.[0].allOf[1].required).toContain('vehicleId');
    expect(bodySchema?.anyOf?.[0].allOf[1].properties).toHaveProperty('vehicleId');
    expect(bodySchema?.anyOf?.[1].allOf[1].required).toEqual(['importMode']);
    expect(bodySchema?.anyOf?.[1].allOf[1].properties).toHaveProperty('importMode');
    expect(bodySchema?.anyOf?.[2].allOf[1].required).toEqual([
      'emissionCycle',
      'driveType',
      'taxableEventDate',
    ]);
    expect(bodySchema?.anyOf?.[2].allOf[1].properties).toHaveProperty('taxableEventDate');
  });
});

/**
 * Every route the vehicle module serves under `vehicles`, in registration order, with the metadata
 * that decides how it is called: HTTP code, dry-run support, mechanic access and OpenAPI operation id.
 */
function vehicleRoutes() {
  const controllers: Type[] = Reflect.getMetadata('controllers', VehicleModule);
  return controllers
    .filter(
      (controller) => Reflect.getMetadata(PATH_METADATA, controller) === 'vehicles',
    )
    .flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter(
          (name) =>
            Reflect.getMetadata(METHOD_METADATA, controller.prototype[name]) !==
            undefined,
        )
        .map((name) => {
          const handler = controller.prototype[name];
          const path = Reflect.getMetadata(PATH_METADATA, handler) as string;
          const operation = Reflect.getMetadata(
            'swagger/apiOperation',
            handler,
          ) as { operationId?: string } | undefined;
          return {
            route: `${RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler)]} /vehicles${path === '/' ? '' : `/${path}`}`,
            httpCode: Reflect.getMetadata('__httpCode__', handler) as
              | number
              | undefined,
            dryRun: Reflect.getMetadata(DRY_RUN_SUPPORTED_KEY, handler) === true,
            mechanicAccessible:
              Reflect.getMetadata(MECHANIC_ACCESSIBLE_KEY, handler) === true ||
              Reflect.getMetadata(MECHANIC_ACCESSIBLE_KEY, controller) === true,
            operationId: operation?.operationId ?? `${controller.name}_${name}`,
          };
        }),
    );
}

describe('vehicle routes', () => {
  const routes = vehicleRoutes();

  it.each([
    ['POST /vehicles/nova/calculate', 200, false, 'VehicleController_calculateNova'],
    ['GET /vehicles/pickerl-due', undefined, false, 'VehicleController_findPickerlDue'],
    ['GET /vehicles/pickerl-due/export', undefined, false, 'VehicleController_exportPickerlDue'],
    ['GET /vehicles/:id/pickerl-open-order', undefined, false, 'VehicleController_findOpenPickerlWorkshopOrder'],
    ['GET /vehicles', undefined, false, 'VehicleController_findAll'],
    ['POST /vehicles', undefined, true, 'VehicleController_create'],
    ['POST /vehicles/:id/resolve-identity', 200, false, 'VehicleController_resolveIdentity'],
    ['GET /vehicles/:id/valuations', undefined, false, 'VehicleController_listValuations'],
    ['POST /vehicles/:id/valuations', undefined, false, 'VehicleController_createValuation'],
    ['GET /vehicles/:id', undefined, false, 'VehicleController_findOne'],
    ['PATCH /vehicles/:id', undefined, false, 'VehicleController_update'],
  ])(
    '%s keeps its status code, dry-run flag, role gate and operation id',
    (route, httpCode, dryRun, operationId) => {
      expect(routes.filter((candidate) => candidate.route === route)).toEqual([
        { route, httpCode, dryRun, mechanicAccessible: false, operationId },
      ]);
    },
  );

  it('serves no other route under vehicles', () => {
    expect(routes).toHaveLength(11);
  });

  it.each([
    ['GET /vehicles/pickerl-due', 'GET /vehicles/:id'],
    ['GET /vehicles/pickerl-due/export', 'GET /vehicles/:id'],
  ])('registers %s before the catch-all %s', (literal, catchAll) => {
    const order = routes.map((candidate) => candidate.route);
    expect(order.indexOf(literal)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(literal)).toBeLessThan(order.indexOf(catchAll));
  });
});
