import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1);
  const sendDefaultPii = process.env.SENTRY_SEND_DEFAULT_PII === 'true';

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
    integrations: [
      Sentry.prismaIntegration({
        prismaInstrumentation: new PrismaInstrumentation(),
      }),
    ],
  });
}
