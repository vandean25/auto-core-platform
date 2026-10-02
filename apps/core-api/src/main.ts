import './instrument.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import {
  createGlobalValidationPipes,
  GlobalExceptionFilter,
  HttpLoggingInterceptor,
  LogLevelService,
  ObserveInstrument,
  isObserveTelemetryConfigured,
} from './common/index.js';
import { validateEnv } from './config/env.js';
import { configureHttpSecurity } from './common/http/http-security.js';
import {
  inspectRuntimeDatabaseUrls,
  logRuntimeDatabaseUrlStatus,
  requireRuntimePooler,
} from './prisma/runtime-database-url-health.js';

async function bootstrap() {
  const env = validateEnv();
  const runtimeDatabaseUrlStatus = inspectRuntimeDatabaseUrls();
  logRuntimeDatabaseUrlStatus(runtimeDatabaseUrlStatus);
  requireRuntimePooler(runtimeDatabaseUrlStatus);

  const observeTelemetry = isObserveTelemetryConfigured();
  const app = await NestFactory.create(AppModule, {
    logger: LogLevelService.getInitialNestLogLevels(),
    routeConflictPolicy: {
      duplicate: 'warn',
      shadow: 'warn',
    },
    ...(observeTelemetry ? { instrument: ObserveInstrument } : {}),
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(...createGlobalValidationPipes());
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new HttpLoggingInterceptor());
  configureHttpSecurity(app, {
    frontendUrl: env.FRONTEND_URL,
    nodeEnv: env.NODE_ENV,
  });

  const port = env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
}
void bootstrap();
