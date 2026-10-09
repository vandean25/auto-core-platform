import type {
  DecisionApplyMode,
  DecisionProviderId,
} from './decision.constants.js';
import {
  DEFAULT_DECISION_HTTP_TIMEOUT_MS,
  OPENROUTER_JEV_DEFAULT_MODEL,
} from './decision.constants.js';

export type DecisionApplyModeResolution = {
  /** Mode allowed by the environment, before any tenant opt-out. */
  mode: DecisionApplyMode;
  /** True when `live` was requested but a production runtime has not opted in. */
  blockedByProductionGate: boolean;
};

export function readDecisionProviderId(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProviderId {
  const raw = env.DECISION_PROVIDER?.trim().toLowerCase();
  if (raw === 'openrouter-jev') {
    return 'openrouter-jev';
  }
  return 'noop';
}

export function readDecisionShadowEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.DECISION_SHADOW_ENABLED?.trim().toLowerCase() === 'true';
}

/** Unknown values are `shadow`, so a typo never turns live-apply on. */
export function readDecisionApplyMode(
  env: NodeJS.ProcessEnv = process.env,
): DecisionApplyMode {
  return env.DECISION_APPLY_MODE?.trim().toLowerCase() === 'live'
    ? 'live'
    : 'shadow';
}

/**
 * Production gate (AUT-395). Cloud Run services run with NODE_ENV=production,
 * including QA, so live-apply there also needs DECISION_LIVE_OPT_IN=true.
 */
export function resolveEnvDecisionApplyMode(
  env: NodeJS.ProcessEnv = process.env,
): DecisionApplyModeResolution {
  if (readDecisionApplyMode(env) !== 'live') {
    return { mode: 'shadow', blockedByProductionGate: false };
  }
  const isProductionRuntime =
    env.NODE_ENV?.trim().toLowerCase() === 'production';
  const hasOptIn = env.DECISION_LIVE_OPT_IN?.trim().toLowerCase() === 'true';
  if (isProductionRuntime && !hasOptIn) {
    return { mode: 'shadow', blockedByProductionGate: true };
  }
  return { mode: 'live', blockedByProductionGate: false };
}

export function readOpenRouterJevModelId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env.DECISION_OPENROUTER_MODEL?.trim();
  return configured && configured.length > 0
    ? configured
    : OPENROUTER_JEV_DEFAULT_MODEL;
}

export function readDecisionHttpTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.DECISION_HTTP_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_DECISION_HTTP_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_DECISION_HTTP_TIMEOUT_MS;
}
