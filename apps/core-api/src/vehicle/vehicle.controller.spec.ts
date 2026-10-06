import 'reflect-metadata';
import { VehicleController } from './vehicle.controller.js';

describe('VehicleController NoVA calculation', () => {
  it('delegates the calculate request to the NoVA service', async () => {
    const request = { netPriceEuro: 20_000, vehicleId: 'vehicle-1' };
    const response = { novaAmountEuro: 1200 };
    const novaCalculationService = {
      calculate: jest.fn().mockResolvedValue(response),
    };
    const controller = new VehicleController(
      {} as never,
      {} as never,
      novaCalculationService as never,
    );

    await expect(controller.calculateNova(request)).resolves.toBe(response);
    expect(novaCalculationService.calculate).toHaveBeenCalledWith(request);
  });

  it('documents vehicle and explicit-input request modes', () => {
    const parameters = Reflect.getMetadata(
      'swagger/apiParameters',
      VehicleController.prototype.calculateNova,
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

    expect(bodySchema?.anyOf).toHaveLength(2);
    expect(bodySchema?.anyOf?.[0].allOf[1].required).toContain('vehicleId');
    expect(bodySchema?.anyOf?.[0].allOf[1].properties).toHaveProperty('vehicleId');
    expect(bodySchema?.anyOf?.[1].allOf[1].required).toEqual([
      'emissionCycle',
      'driveType',
      'taxableEventDate',
    ]);
    expect(bodySchema?.anyOf?.[1].allOf[1].properties).toHaveProperty('taxableEventDate');
  });
});
