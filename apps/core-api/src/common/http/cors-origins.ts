import { Logger } from '@nestjs/common';

const setupLogger = new Logger('CorsSetup');
const DEVELOPMENT_DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

export function resolveCorsOrigins(
  frontendUrl = process.env.FRONTEND_URL,
  nodeEnv = process.env.NODE_ENV,
): string[] {
  const configuredOrigins = frontendUrl
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins && configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (nodeEnv === 'production') {
    throw new Error(
      'CRITICAL: Starting the server without FRONTEND_URL is a critical misconfiguration. It must contain the allowed frontend origin(s) for the dashboard-realtime gateway.',
    );
  }

  setupLogger.warn(
    `WARNING: CORS origins are empty because FRONTEND_URL is not set. Falling back to development origins: ${DEVELOPMENT_DEFAULT_ORIGINS.join(', ')}`,
  );
  return DEVELOPMENT_DEFAULT_ORIGINS;
}
