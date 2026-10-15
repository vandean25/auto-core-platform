import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppEnv } from '../../config/env.js';
import { resolveCorsOrigins } from './cors-origins.js';
import {
  configureHttpCors,
  resolveLandingPageOrigins,
} from './landing-demo-cors.js';

export interface HttpSecurityOptions {
  frontendUrl?: string;
  nodeEnv: AppEnv['NODE_ENV'];
}

export function configureHttpSecurity(
  app: INestApplication,
  options: HttpSecurityOptions,
): void {
  const expressApplication = app.getHttpAdapter().getInstance() as {
    set(name: string, value: unknown): void;
  };
  expressApplication.set('trust proxy', true);

  if (options.nodeEnv === 'production') {
    app.use(helmet());
  }

  configureHttpCors(app, {
    dashboardOrigins: resolveCorsOrigins(options.frontendUrl, options.nodeEnv),
    landingPageOrigins: resolveLandingPageOrigins(),
  });
}
