import 'dotenv/config';
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1);

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT || (process.env.NODE_ENV ?? 'development'),
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.1,
    integrations: [Sentry.prismaIntegration()],
    beforeSend(event) {
      // AUT-411: tenant API keys travel in the Authorization header. Never send that header to error tracking.
      const headers = event.request?.headers;
      if (headers) {
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'authorization') {
            delete headers[name];
          }
        }
      }
      return event;
    },
  });
}
