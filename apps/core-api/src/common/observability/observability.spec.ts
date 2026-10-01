import { describe, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AppObservabilityModule, ObserveInstrument } from './observability.module.js';

describe('AppObservabilityModule', () => {
  let moduleRef: TestingModule;

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('compiles and initializes ObserveModule via AppObservabilityModule.register()', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppObservabilityModule.register()],
    }).compile();

    expect(moduleRef).toBeDefined();
  });

  it('provides ObserveInstrument for method-level APM telemetry', () => {
    expect(ObserveInstrument).toBeDefined();
    expect(typeof ObserveInstrument.instanceDecorator).toBe('function');
  });
});
