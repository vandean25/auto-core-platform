import type { INestApplication, NestInterceptor } from '@nestjs/common';
import {
  createGlobalValidationPipes,
  GlobalExceptionFilter,
} from '../index.js';
import { HttpLoggingInterceptor } from '../logging/index.js';
import { configureHttpSecurity } from './http-security.js';

export function configureCoreHttpApp(
  app: INestApplication,
  options: {
    frontendUrl?: string;
    nodeEnv: 'development' | 'production' | 'test';
    extraInterceptors?: NestInterceptor[];
  },
): void {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(...createGlobalValidationPipes());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new HttpLoggingInterceptor(),
    ...(options.extraInterceptors ?? []),
  );
  configureHttpSecurity(app, {
    frontendUrl: options.frontendUrl,
    nodeEnv: options.nodeEnv,
  });
}
