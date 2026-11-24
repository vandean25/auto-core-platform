import './instrument.js';
import { NestFactory } from '@nestjs/core';
import { ApiRootModule } from './api-root.module.js';
import { ObserveInstrument, isObserveTelemetryConfigured } from './common/index.js';
import { configureCoreHttpApp } from './common/http/configure-core-http-app.js';
import { LogLevelService } from './common/logging/index.js';
import { validateEnv } from './config/env.js';
import { assertE2eFullstackInMemoryPdfAllowed } from './e2e-fullstack/assert-in-memory-pdf-allowed.js';
import {
  inspectRuntimeDatabaseUrls,
  logRuntimeDatabaseUrlStatus,
  requireRuntimePooler,
} from './prisma/runtime-database-url-health.js';
import { ScheduledJobTriggerInterceptor } from './scheduler/scheduled-job-trigger.interceptor.js';
import {
  ScheduledJobTriggerService,
  runStartupScheduledJobTrigger,
} from './scheduler/scheduled-job-trigger.service.js';

async function bootstrap() {
  const env = validateEnv();
  const runtimeDatabaseUrlStatus = inspectRuntimeDatabaseUrls();
  logRuntimeDatabaseUrlStatus(runtimeDatabaseUrlStatus);
  requireRuntimePooler(runtimeDatabaseUrlStatus);

  const observeTelemetry = isObserveTelemetryConfigured();
  const app = await NestFactory.create(ApiRootModule, {
    logger: LogLevelService.getInitialNestLogLevels(),
    routeConflictPolicy: {
      duplicate: 'warn',
      shadow: 'warn',
    },
    ...(observeTelemetry ? { instrument: ObserveInstrument } : {}),
  });

  const inMemoryPdfEnabled = process.env.E2E_FULLSTACK_IN_MEMORY_PDF === 'true';
  assertE2eFullstackInMemoryPdfAllowed(env.NODE_ENV, inMemoryPdfEnabled);
  if (inMemoryPdfEnabled) {
    const { installInMemoryInvoicePdfStorage } =
      await import('./e2e-fullstack/in-memory-invoice-pdf-storage.js');
    installInMemoryInvoicePdfStorage(app, { mockRenderer: false });
  }

  configureCoreHttpApp(app, {
    frontendUrl: env.FRONTEND_URL,
    nodeEnv: env.NODE_ENV,
    extraInterceptors: [
      new ScheduledJobTriggerInterceptor(app.get(ScheduledJobTriggerService)),
    ],
  });

  const port = env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`Application is running on: http://0.0.0.0:${port}`);
  runStartupScheduledJobTrigger(app);
}
void bootstrap();
