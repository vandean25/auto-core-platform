import { describe, it, expect } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  AppObservabilityModule,
  ObserveInstrument,
  isObserveTelemetryConfigured,
} from './observability.module.js';

function restoreEnv(name: string, previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = previous;
}

describe('AppObservabilityModule', () => {
  let moduleRef: TestingModule;

  afterEach(async () => {
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  it('skips ObserveModule registration when credentials are absent', async () => {
    const previousKey = process.env.OBSERVE_APP_KEY;
    const previousSecret = process.env.OBSERVE_APP_SECRET;
    delete process.env.OBSERVE_APP_KEY;
    delete process.env.OBSERVE_APP_SECRET;

    try {
      expect(isObserveTelemetryConfigured()).toBe(false);
      moduleRef = await Test.createTestingModule({
        imports: [AppObservabilityModule.register()],
      }).compile();
      expect(moduleRef).toBeDefined();
    } finally {
      restoreEnv('OBSERVE_APP_KEY', previousKey);
      restoreEnv('OBSERVE_APP_SECRET', previousSecret);
    }
  });

  it('compiles and initializes ObserveModule when credentials are provided', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        AppObservabilityModule.register({
          appKey: 'test-app-key',
          appSecret: 'test-app-secret',
        }),
      ],
    }).compile();

    expect(moduleRef).toBeDefined();
  });

  it('provides ObserveInstrument for method-level APM telemetry', () => {
    expect(ObserveInstrument).toBeDefined();
    expect(typeof ObserveInstrument.instanceDecorator).toBe('function');
  });
});
