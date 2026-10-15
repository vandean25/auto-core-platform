import { z } from 'zod';

const optionalTrimmed = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  });

const optionalBoolean = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  },
  z.enum(['true', 'false']).optional(),
);

const configSchema = z.object({
  LANDING_DEMO_ACCESS_ENABLED: optionalBoolean.transform(
    (value) => value === 'true',
  ),
  LANDING_PAGE_ORIGINS: optionalTrimmed,
  LANDING_DEMO_TENANT_SLUG: optionalTrimmed,
  LANDING_DEMO_OPERATOR_EMAIL: optionalTrimmed,
  LANDING_DEMO_SIGN_IN_CONTINUE_URL: optionalTrimmed,
  LANDING_DEMO_TURNSTILE_ENABLED: optionalBoolean.transform(
    (value) => value === 'true',
  ),
  LANDING_DEMO_TURNSTILE_SECRET: optionalTrimmed,
  LANDING_DEMO_RATE_LIMIT_IP_MAX: optionalTrimmed,
  LANDING_DEMO_RATE_LIMIT_IP_TTL_SECONDS: optionalTrimmed,
  LANDING_DEMO_RATE_LIMIT_EMAIL_MAX: optionalTrimmed,
  LANDING_DEMO_RATE_LIMIT_EMAIL_TTL_SECONDS: optionalTrimmed,
  LANDING_DEMO_CONSENT_TEXT_VERSION: optionalTrimmed,
});

export type LandingDemoAccessConfig = {
  enabled: boolean;
  landingPageOrigins: string[];
  demoTenantSlug: string;
  operatorEmail: string;
  signInContinueUrl: string | undefined;
  turnstileEnabled: boolean;
  turnstileSecret: string | undefined;
  rateLimitIp: { max: number; ttlSeconds: number };
  rateLimitEmail: { max: number; ttlSeconds: number };
  consentTextVersion: string;
};

const DEFAULT_OPERATOR_EMAIL = 'van.dean25@gmail.com';
const DEFAULT_DEMO_TENANT_SLUG = 'selbstservice-demo';
const DEFAULT_CONSENT_VERSION = 'landing-demo-2026-10';

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readLandingDemoAccessConfig(
  env: NodeJS.ProcessEnv = process.env,
): LandingDemoAccessConfig {
  const parsed = configSchema.parse(env);
  const landingPageOrigins =
    parsed.LANDING_PAGE_ORIGINS?.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean) ?? [];

  return {
    enabled: parsed.LANDING_DEMO_ACCESS_ENABLED ?? false,
    landingPageOrigins,
    demoTenantSlug: parsed.LANDING_DEMO_TENANT_SLUG ?? DEFAULT_DEMO_TENANT_SLUG,
    operatorEmail:
      parsed.LANDING_DEMO_OPERATOR_EMAIL ?? DEFAULT_OPERATOR_EMAIL,
    signInContinueUrl: parsed.LANDING_DEMO_SIGN_IN_CONTINUE_URL,
    turnstileEnabled: parsed.LANDING_DEMO_TURNSTILE_ENABLED ?? false,
    turnstileSecret: parsed.LANDING_DEMO_TURNSTILE_SECRET,
    rateLimitIp: {
      max: parsePositiveInt(parsed.LANDING_DEMO_RATE_LIMIT_IP_MAX, 10),
      ttlSeconds: parsePositiveInt(
        parsed.LANDING_DEMO_RATE_LIMIT_IP_TTL_SECONDS,
        3600,
      ),
    },
    rateLimitEmail: {
      max: parsePositiveInt(parsed.LANDING_DEMO_RATE_LIMIT_EMAIL_MAX, 3),
      ttlSeconds: parsePositiveInt(
        parsed.LANDING_DEMO_RATE_LIMIT_EMAIL_TTL_SECONDS,
        86400,
      ),
    },
    consentTextVersion:
      parsed.LANDING_DEMO_CONSENT_TEXT_VERSION ?? DEFAULT_CONSENT_VERSION,
  };
}
