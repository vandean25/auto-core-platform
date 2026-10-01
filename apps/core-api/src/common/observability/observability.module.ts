import { DynamicModule, Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';

const { ObserveModule, ObserveInstrument } = createObserveModule({
  attachTraceIdToLogs: false,
});

export { ObserveInstrument };

export interface AppObservabilityOptions {
  appKey?: string;
  appSecret?: string;
  serviceId?: string;
}

@Module({})
export class AppObservabilityModule {
  static register(options?: AppObservabilityOptions): DynamicModule {
    const appKey =
      options?.appKey || process.env.OBSERVE_APP_KEY || 'dev-app-key';
    const appSecret =
      options?.appSecret || process.env.OBSERVE_APP_SECRET || 'dev-app-secret';
    const serviceId =
      options?.serviceId || process.env.OBSERVE_SERVICE_ID || 'core-api';

    return {
      module: AppObservabilityModule,
      imports: [
        ObserveModule.forRoot({
          appKey,
          appSecret,
          serviceId,
        }),
      ],
      exports: [ObserveModule],
    };
  }
}
