import { NestFactory } from '@nestjs/core';
import { PlaywrightBrowserService } from './common/index.js';
import { configureCoreHttpApp } from './common/http/configure-core-http-app.js';
import { LogLevelService } from './common/logging/index.js';
import { validateEnv } from './config/env.js';
import { PdfWorkerModule } from './pdf-worker/pdf-worker.module.js';
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

  const app = await NestFactory.create(PdfWorkerModule, {
    logger: LogLevelService.getInitialNestLogLevels(),
  });

  configureCoreHttpApp(app, {
    frontendUrl: env.FRONTEND_URL,
    nodeEnv: env.NODE_ENV,
  });

  const port = env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`PDF worker is running on: http://0.0.0.0:${port}`);

  // Non-blocking warm-up & lazy Sentry init after listen() so readiness probe succeeds immediately.
  const browserService = app.get(PlaywrightBrowserService);
  void browserService.warmUp();
  void import('./instrument.js').catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Lazy Sentry initialization failed: ${message}`);
  });
}

void bootstrap();
