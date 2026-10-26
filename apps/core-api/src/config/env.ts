import { z } from 'zod';
import { resolveSchedulerMode } from '../scheduler/scheduler-mode.js';
import { parseApprovalBaseUrl } from '../workshop/workshop-estimate-approval-token.helpers.js';
import {
  NOTIFICATION_ENV_KEYS,
  notificationEnvIssues,
  notificationEnvShape,
} from './notification-env.js';

const SECRET_ENCRYPTION_KEY_BYTES = 32;
const API_KEY_PEPPER_MIN_BYTES = 32;
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
  'SENTRY_ENVIRONMENT',
  'SENTRY_SEND_DEFAULT_PII',
  'SENTRY_TRACES_SAMPLE_RATE',
  'ENABLE_SENTRY_DEBUG_ROUTE',
  'INVOICE_PDF_BUCKET',
  'DOCUMENT_BRANDING_BUCKET',
  'DOCUMENT_BRAND_EXTRACTION_PROVIDER',
  'DOCUMENT_BRAND_EXTRACTION_MODEL',
  'OPENROUTER_API_KEY',
  'DECISION_PROVIDER',
  'DECISION_SHADOW_ENABLED',
  'SCHEDULER_ENABLED',
  'SCHEDULER_MODE',
  'CRON_OIDC_AUDIENCE',
  'CRON_INVOKER_SA_EMAIL',
  'DECISION_OPENROUTER_MODEL',
  'DECISION_HTTP_TIMEOUT_MS',
  'INVOICE_BRANDING_WRITER_ENABLED',
  'ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED',
  'ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED',
  'CUSTOMER_ESTIMATE_SEND_ENABLED',
  'VEHICLE_LISTING_AS24_PUSH_ENABLED',
  'AUTOSCOUT24_DMS_API_BASE_URL',
  'AUTOSCOUT24_DMS_API_CREDENTIALS_SECRET_REF',
  'AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS',
  'AUTOSCOUT24_DMS_USE_FAKE_ADAPTER',
  'ESTIMATE_APPROVAL_BASE_URL',
  'WORKSHOP_MEDIA_BUCKET',
  'WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_PURGE_ENABLED',
  'WORKSHOP_CHECK_IN_ORPHAN_UPLOAD_TTL_HOURS',
  'VEHICLE_MEDIA_BUCKET',
  'VEHICLE_MEDIA_PORTAL_VARIANTS_JSON',
  'CLOUD_TASKS_ENABLED',
  'CLOUD_TASKS_LOCATION',
  'CLOUD_TASKS_QUEUE',
  'CLOUD_TASKS_TARGET_BASE_URL',
  'CLOUD_TASKS_WORKER_SECRET',
  'CLOUD_TASKS_INVOKER_SA',
  ...NOTIFICATION_ENV_KEYS,
  'GCP_CREDENTIALS',
  'SECRET_ENCRYPTION_KEY',
  'CATALOG_HIT_HMAC_SECRET',
  'API_KEY_PEPPER',
  'DEFAULT_VAT_RATE',
  'GOOGLE_CLOUD_PROJECT',
  'FIREBASE_PROJECT_ID',
  'GSM_MAPPING_PATH',
  'VOICE_NOTE_RATE_LIMIT_MAX',
  'VOICE_NOTE_RATE_LIMIT_TTL_SECONDS',
  'OBSERVE_APP_KEY',
  'OBSERVE_APP_SECRET',
  'OBSERVE_SERVICE_ID',
  'MCP_SERVER_ENABLED',
  'REGISTRATION_DOCUMENT_EXTRACTION_PROVIDER',
  'REGISTRATION_INTAKE_BUCKET',
  'LANDING_DEMO_ACCESS_ENABLED',
  'LANDING_PAGE_ORIGINS',
  'LANDING_DEMO_TENANT_SLUG',
  'LANDING_DEMO_OPERATOR_EMAIL',
  'LANDING_DEMO_SIGN_IN_CONTINUE_URL',
  'LANDING_DEMO_TURNSTILE_ENABLED',
  'LANDING_DEMO_TURNSTILE_SECRET',
  'LANDING_DEMO_RATE_LIMIT_IP_MAX',
  'LANDING_DEMO_RATE_LIMIT_IP_TTL_SECONDS',
  'LANDING_DEMO_RATE_LIMIT_EMAIL_MAX',
  'LANDING_DEMO_RATE_LIMIT_EMAIL_TTL_SECONDS',
  'LANDING_DEMO_CONSENT_TEXT_VERSION',
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
    SENTRY_ENVIRONMENT: optionalString,
    SENTRY_SEND_DEFAULT_PII: optionalString,
    SENTRY_TRACES_SAMPLE_RATE: optionalString,
    ENABLE_SENTRY_DEBUG_ROUTE: optionalString,
    INVOICE_PDF_BUCKET: optionalString,
    DOCUMENT_BRANDING_BUCKET: optionalString,
    DOCUMENT_BRAND_EXTRACTION_PROVIDER: optionalString,
    DOCUMENT_BRAND_EXTRACTION_MODEL: optionalString,
    OPENROUTER_API_KEY: optionalString,
    DECISION_PROVIDER: optionalString,
    DECISION_SHADOW_ENABLED: optionalBooleanString,
    SCHEDULER_ENABLED: optionalBooleanString,
    SCHEDULER_MODE: optionalString,
    CRON_OIDC_AUDIENCE: optionalString,
    CRON_INVOKER_SA_EMAIL: optionalString,
    DECISION_OPENROUTER_MODEL: optionalString,
    DECISION_HTTP_TIMEOUT_MS: optionalString,
    INVOICE_BRANDING_WRITER_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
    ACCOUNTING_EXPORT_RZL_SERIALIZER_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
    ACCOUNTING_EXPORT_BMD_SERIALIZER_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
    CUSTOMER_ESTIMATE_SEND_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
    VEHICLE_LISTING_AS24_PUSH_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
    AUTOSCOUT24_DMS_API_BASE_URL: optionalString,
    AUTOSCOUT24_DMS_API_CREDENTIALS_SECRET_REF: optionalString,
    AUTOSCOUT24_DMS_HTTP_TIMEOUT_MS: optionalString,
    AUTOSCOUT24_DMS_USE_FAKE_ADAPTER: optionalBooleanString,
    ESTIMATE_APPROVAL_BASE_URL: optionalString,
    WORKSHOP_MEDIA_BUCKET: optionalString,
    VEHICLE_MEDIA_BUCKET: optionalString,
    VEHICLE_MEDIA_PORTAL_VARIANTS_JSON: optionalString,
    CLOUD_TASKS_ENABLED: optionalString,
    CLOUD_TASKS_LOCATION: optionalString,
    CLOUD_TASKS_QUEUE: optionalString,
    CLOUD_TASKS_TARGET_BASE_URL: optionalString,
    CLOUD_TASKS_WORKER_SECRET: optionalString,
    CLOUD_TASKS_INVOKER_SA: optionalString,
    ...notificationEnvShape,
    GCP_CREDENTIALS: optionalString,
    SECRET_ENCRYPTION_KEY: optionalString,
    CATALOG_HIT_HMAC_SECRET: optionalString,
    API_KEY_PEPPER: optionalString,
    DEFAULT_VAT_RATE: optionalString,
    GOOGLE_CLOUD_PROJECT: optionalString,
    FIREBASE_PROJECT_ID: optionalString,
    GSM_MAPPING_PATH: optionalString,
    VOICE_NOTE_RATE_LIMIT_MAX: optionalString,
    VOICE_NOTE_RATE_LIMIT_TTL_SECONDS: optionalString,
    OBSERVE_APP_KEY: optionalString,
    OBSERVE_APP_SECRET: optionalString,
    OBSERVE_SERVICE_ID: optionalString,
    MCP_SERVER_ENABLED: optionalBooleanString.transform(
      (value) => value === 'true',
    ),
  })
  .superRefine((env, ctx) => {
    // Optional everywhere (ADR-0026): unset disables tenant API keys (fail closed); a bad value must still fail boot.
    addApiKeyPepperIssues(ctx, env.API_KEY_PEPPER);
    for (const issue of notificationEnvIssues(env)) {
      if (issue.kind === 'required') {
        addRequiredIssue(ctx, issue.key, undefined);
      } else {
        ctx.addIssue({
          code: 'custom',
          path: [issue.key],
          message: 'invalid',
          continue: true,
        });
      }
    }

    // The estimate email carries the approval link, so the send needs a usable https base (ADR-0025 §7). Checked in every
    // environment, so a test run refuses the same bad base that production would.
    if (env.CUSTOMER_ESTIMATE_SEND_ENABLED) {
      addRequiredIssue(
        ctx,
        'ESTIMATE_APPROVAL_BASE_URL',
        env.ESTIMATE_APPROVAL_BASE_URL,
      );
      if (
        env.ESTIMATE_APPROVAL_BASE_URL &&
        parseApprovalBaseUrl(env.ESTIMATE_APPROVAL_BASE_URL) === null
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['ESTIMATE_APPROVAL_BASE_URL'],
          message: 'invalid',
          continue: true,
        });
      }
    }

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

    if (resolveSchedulerMode(env) === 'http') {
      addRequiredIssue(ctx, 'CRON_OIDC_AUDIENCE', env.CRON_OIDC_AUDIENCE);
      addRequiredIssue(ctx, 'CRON_INVOKER_SA_EMAIL', env.CRON_INVOKER_SA_EMAIL);
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

function addApiKeyPepperIssues(
  ctx: z.RefinementCtx,
  rawPepper: string | undefined,
): void {
  if (!rawPepper) {
    return;
  }
  if (Buffer.from(rawPepper, 'base64').length >= API_KEY_PEPPER_MIN_BYTES) {
    return;
  }
  ctx.addIssue({
    code: 'custom',
    path: ['API_KEY_PEPPER'],
    message: `API_KEY_PEPPER must be a base64-encoded key of at least ${API_KEY_PEPPER_MIN_BYTES} bytes.`,
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
  if (invalid.includes('API_KEY_PEPPER')) {
    parts.push(
      `API_KEY_PEPPER must be a base64-encoded key of at least ${API_KEY_PEPPER_MIN_BYTES} bytes.`,
    );
  }
  return parts.join(' ');
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}
