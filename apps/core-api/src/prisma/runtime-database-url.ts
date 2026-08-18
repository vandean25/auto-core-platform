export function resolveRuntimeDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const pooledUrl = env.DATABASE_URL_POOLED?.trim();
  if (pooledUrl) {
    return pooledUrl;
  }

  const directUrl = env.DATABASE_URL?.trim();
  return directUrl || undefined;
}
