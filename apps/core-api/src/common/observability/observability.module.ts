import { DynamicModule, Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import type { Request } from 'express';
import { isPublicEstimateApprovalRequest } from '../../workshop/public-estimate-approval/public-estimate-approval.constants.js';

const { ObserveModule, ObserveInstrument } = createObserveModule({
  attachTraceIdToLogs: false,
});

export { ObserveInstrument };

export interface AppObservabilityOptions {
  appKey?: string;
  appSecret?: string;
  serviceId?: string;
}

/**
 * Observe options. The approval route carries its token in the path (ADR-0025 §7), so its requests are not traced:
 * the token must not reach the third-party APM.
 */
export function buildObserveRootOptions(
  appKey: string,
  appSecret: string,
  serviceId: string,
) {
  return {
    appKey,
    appSecret,
    serviceId,
    http: {
      ignore: (request: Pick<Request, 'originalUrl' | 'url'>): boolean =>
        isPublicEstimateApprovalRequest(request),
    },
  };
}

function readTrimmedEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === '' ? undefined : value;
}

export function isObserveTelemetryConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const appKey = env.OBSERVE_APP_KEY?.trim();
  const appSecret = env.OBSERVE_APP_SECRET?.trim();
  return Boolean(appKey && appSecret);
}

@Module({})
export class AppObservabilityModule {
  static register(options?: AppObservabilityOptions): DynamicModule {
    const appKey = options?.appKey ?? readTrimmedEnv('OBSERVE_APP_KEY');
    const appSecret =
      options?.appSecret ?? readTrimmedEnv('OBSERVE_APP_SECRET');
    const serviceId =
      options?.serviceId ?? readTrimmedEnv('OBSERVE_SERVICE_ID') ?? 'core-api';

    if (!appKey || !appSecret) {
      return {
        module: AppObservabilityModule,
      };
    }

    return {
      module: AppObservabilityModule,
      imports: [
        ObserveModule.forRoot(
          buildObserveRootOptions(appKey, appSecret, serviceId),
        ),
      ],
      exports: [ObserveModule],
    };
  }
}
