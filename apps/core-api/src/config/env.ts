import { z } from 'zod';

const SECRET_ENCRYPTION_KEY_BYTES = 32;
const REQUIRED_ISSUE = 'Required';

export const DOCUMENTED_ENV_KEYS = [
  'DATABASE_URL',
  'DATABASE_URL_POOLED',
  'DATABASE_POOLER_REQUIRED',
  'PORT',
  'NODE_ENV',
  'LOG_LEVEL',
  'FRONTEND_URL',
  'REDIS_URL',
  'SENTRY_DSN',
  'SENTRY_RELEASE',
  'SENTRY_SEND_DEFAULT_PII',
  'SENTRY_TRACES_SAMPLE_RATE',
  'ENABLE_SENTRY_DEBUG_ROUTE',
  'INVOICE_PDF_BUCKET',
  'WORKSHOP_MEDIA_BUCKET',
  'CLOUD_TASKS_ENABLED',
  'CLOUD_TASKS_LOCATION',
  'CLOUD_TASKS_QUEUE',
  'CLOUD_TASKS_TARGET_BASE_URL',
  'CLOUD_TASKS_WORKER_SECRET',
  'CLOUD_TASKS_INVOKER_SA',
  'GCP_CREDENTIALS',
  'SECRET_ENCRYPTION_KEY',
  'CATALOG_HIT_HMAC_SECRET',
  'DEFAULT_VAT_RATE',
  'GOOGLE_CLOUD_PROJECT',
  'FIREBASE_PROJECT_ID',
  'GSM_MAPPING_PATH',
  'VOICE_NOTE_RATE_LIMIT_MAX',
  'VOICE_NOTE_RATE_LIMIT_TTL_SECONDS',
] as const;

export type DocumentedEnvKey = (typeof DOCUMENTED_ENV_KEYS)[number];

const optionalString = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const optionalBooleanString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z.enum(['true', 'false']).optional(),
);

const nodeEnvSchema = z.preprocess(
  (value) => {
    if (value === 'production' || value === 'test' || value === 'development') {
      return value;
    }
    return 'development';
  },
  z.enum(['development', 'test', 'production']),
);

const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    DATABASE_URL: optionalString,
    DATABASE_URL_POOLED: optionalString,
    DATABASE_POOLER_REQUIRED: optionalBooleanString,
    PORT: optionalString,
    LOG_LEVEL: optionalString,
    FRONTEND_URL: optionalString,
    REDIS_URL: optionalString,
    SENTRY_DSN: optionalString,
    SENTRY_RELEASE: optionalString,
    SENTRY_SEND_DEFAULT_PII: optionalString,
    SENTRY_TRACES_SAMPLE_RATE: optionalString,
    ENABLE_SENTRY_DEBUG_ROUTE: optionalString,
    INVOICE_PDF_BUCKET: optionalString,
    WORKSHOP_MEDIA_BUCKET: optionalString,
    CLOUD_TASKS_ENABLED: optionalString,
    CLOUD_TASKS_LOCATION: optionalString,
    CLOUD_TASKS_QUEUE: optionalString,
    CLOUD_TASKS_TARGET_BASE_URL: optionalString,
    CLOUD_TASKS_WORKER_SECRET: optionalString,
    CLOUD_TASKS_INVOKER_SA: optionalString,
    GCP_CREDENTIALS: optionalString,
    SECRET_ENCRYPTION_KEY: optionalString,
    CATALOG_HIT_HMAC_SECRET: optionalString,
    DEFAULT_VAT_RATE: optionalString,
    GOOGLE_CLOUD_PROJECT: optionalString,
    FIREBASE_PROJECT_ID: optionalString,
    GSM_MAPPING_PATH: optionalString,
    VOICE_NOTE_RATE_LIMIT_MAX: optionalString,
    VOICE_NOTE_RATE_LIMIT_TTL_SECONDS: optionalString,
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'test') {
      return;
    }

    addRequiredIssue(ctx, 'DATABASE_URL', env.DATABASE_URL);
    addEncryptionKeyIssues(ctx, env.SECRET_ENCRYPTION_KEY);
    addRequiredIssue(
      ctx,
      'CATALOG_HIT_HMAC_SECRET',
      env.CATALOG_HIT_HMAC_SECRET,
    );

    if (env.NODE_ENV === 'production') {
      addRequiredIssue(
        ctx,
        'FIREBASE_PROJECT_ID',
        env.FIREBASE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT,
      );
      addRequiredIssue(ctx, 'FRONTEND_URL', env.FRONTEND_URL);
    }

    if (arePdfWorkersEnabled(env)) {
      addRequiredIssue(
        ctx,
        'CLOUD_TASKS_WORKER_SECRET',
        env.CLOUD_TASKS_WORKER_SECRET,
      );
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(
    readonly missing: readonly string[],
    readonly invalid: readonly string[],
  ) {
    super(formatEnvValidationMessage(missing, invalid));
    this.name = 'EnvValidationError';
  }
}

export function validateEnv(env: NodeJS.ProcessEnv = process.env): AppEnv {
  const result = envSchema.safeParse(env);
  if (result.success) {
    return result.data;
  }

  const missing: string[] = [];
  const invalid: string[] = [];
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? '');
    if (!key) {
      continue;
    }
    if (issue.message === REQUIRED_ISSUE) {
      pushUnique(missing, key);
      continue;
    }
    pushUnique(invalid, key);
  }

  throw new EnvValidationError(missing, invalid);
}

function addRequiredIssue(
  ctx: z.RefinementCtx,
  key: DocumentedEnvKey,
  value: string | undefined,
): void {
  if (value) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    path: [key],
    message: REQUIRED_ISSUE,
    continue: true,
  });
}

function addEncryptionKeyIssues(
  ctx: z.RefinementCtx,
  rawKey: string | undefined,
): void {
  if (!rawKey) {
    addRequiredIssue(ctx, 'SECRET_ENCRYPTION_KEY', rawKey);
    return;
  }
  if (isValidEncryptionKey(rawKey)) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    path: ['SECRET_ENCRYPTION_KEY'],
    message: 'SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.',
    continue: true,
  });
}

function arePdfWorkersEnabled(env: {
  NODE_ENV: AppEnv['NODE_ENV'];
  CLOUD_TASKS_ENABLED?: string;
  CLOUD_TASKS_LOCATION?: string;
  CLOUD_TASKS_QUEUE?: string;
}): boolean {
  if (env.CLOUD_TASKS_ENABLED === 'false') {
    return false;
  }
  if (env.CLOUD_TASKS_ENABLED === 'true') {
    return true;
  }
  return (
    env.NODE_ENV === 'production' &&
    Boolean(env.CLOUD_TASKS_LOCATION || env.CLOUD_TASKS_QUEUE)
  );
}

function isValidEncryptionKey(raw: string): boolean {
  return Buffer.from(raw, 'base64').length === SECRET_ENCRYPTION_KEY_BYTES;
}

function formatEnvValidationMessage(
  missing: readonly string[],
  invalid: readonly string[],
): string {
  const parts = ['Invalid API environment configuration.'];
  if (missing.length > 0) {
    parts.push(
      `Missing required environment variables: ${missing.join(', ')}.`,
    );
  }
  if (invalid.length > 0) {
    parts.push(`Invalid environment variables: ${invalid.join(', ')}.`);
  }
  if (invalid.includes('SECRET_ENCRYPTION_KEY')) {
    parts.push('SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  return parts.join(' ');
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
