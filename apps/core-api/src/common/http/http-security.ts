import type { INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppEnv } from '../../config/env';
import { resolveCorsOrigins } from './cors-origins';

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
    app.use(helmet({ contentSecurityPolicy: false }));
  }

  app.enableCors({
    origin: resolveCorsOrigins(options.frontendUrl, options.nodeEnv),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });
}
