export type RuntimeDatabaseUrlStatus = {
  nodeEnvironment: string;
  directHost: string | undefined;
  pooledHost: string | undefined;
  pooledConfigured: boolean;
  pooledHostContainsPooler: boolean;
  pooledHostEqualsDirect: boolean;
  poolerRequired: boolean;
  mismatch: boolean;
};

export type RuntimeDatabaseUrlLogger = Pick<Console, 'log' | 'warn'>;

export function inspectRuntimeDatabaseUrls(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeDatabaseUrlStatus {
  const directUrl = env.DATABASE_URL?.trim();
  const pooledUrl = env.DATABASE_URL_POOLED?.trim();
  const directHost = extractHostname(directUrl);
  const pooledHost = extractHostname(pooledUrl);
  const pooledHostContainsPooler = pooledHost?.includes('-pooler') ?? false;
  const pooledHostEqualsDirect =
    directHost !== undefined &&
    pooledHost !== undefined &&
    directHost === pooledHost;

  return {
    nodeEnvironment: env.NODE_ENV ?? 'development',
    directHost,
    pooledHost,
    pooledConfigured: Boolean(pooledUrl),
    pooledHostContainsPooler,
    pooledHostEqualsDirect,
    poolerRequired: env.DATABASE_POOLER_REQUIRED?.trim() === 'true',
    mismatch: !pooledHostContainsPooler || pooledHostEqualsDirect,
  };
}

export function requireRuntimePooler(status: RuntimeDatabaseUrlStatus): void {
  if (
    status.nodeEnvironment !== 'production' ||
    !status.poolerRequired ||
    !status.mismatch
  ) {
    return;
  }

  throw new Error(
    'DATABASE_POOLER_REQUIRED=true but DATABASE_URL_POOLED is not a distinct Neon -pooler endpoint.',
  );
}

export function logRuntimeDatabaseUrlStatus(
  status: RuntimeDatabaseUrlStatus,
  logger: RuntimeDatabaseUrlLogger = console,
): void {
  const event = JSON.stringify({
    event: 'runtime_database_url_check',
    severity:
      status.nodeEnvironment === 'production' && status.mismatch
        ? 'WARNING'
        : 'INFO',
    nodeEnvironment: status.nodeEnvironment,
    directHost: status.directHost,
    pooledHost: status.pooledHost,
    pooledConfigured: status.pooledConfigured,
    pooledHostContainsPooler: status.pooledHostContainsPooler,
    pooledHostEqualsDirect: status.pooledHostEqualsDirect,
    poolerRequired: status.poolerRequired,
    mismatch: status.mismatch,
  });

  if (status.nodeEnvironment === 'production' && status.mismatch) {
    logger.warn(event);
    return;
  }

  logger.log(event);
}

function extractHostname(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}
