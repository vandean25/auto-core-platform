export function resolveDirectDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const directUrl = env.DATABASE_URL?.trim();
  return directUrl || undefined;
}

export function resolveRuntimeDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const pooledUrl = env.DATABASE_URL_POOLED?.trim();
  if (pooledUrl) {
    return pooledUrl;
  }

  return resolveDirectDatabaseUrl(env);
}
