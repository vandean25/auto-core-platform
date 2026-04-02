import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { PrismaInstrumentation } from '@prisma/instrumentation';

Sentry.init({
  dsn:
    process.env.SENTRY_DSN ??
    'https://fa07a2a51c6508054dc8917eca1da5ce@o4511150371700736.ingest.de.sentry.io/4511150441758800',
  sendDefaultPii: true,
  tracesSampleRate: 1.0,
  integrations: [
    Sentry.prismaIntegration({
      prismaInstrumentation: new PrismaInstrumentation(),
    }),
  ],
});
