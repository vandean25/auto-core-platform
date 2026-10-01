import { DynamicModule, Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';

const { ObserveModule, ObserveInstrument } = createObserveModule({
  attachTraceIdToLogs: false,
});

export { ObserveInstrument };

@Module({})
export class AppObservabilityModule {
  static register(): DynamicModule {
    return {
      module: AppObservabilityModule,
      imports: [ObserveModule.forRoot()],
      exports: [ObserveModule],
    };
  }
}
