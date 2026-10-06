import type { DecisionProviderId } from './decision.constants.js';
import {
  DEFAULT_DECISION_HTTP_TIMEOUT_MS,
  OPENROUTER_JEV_DEFAULT_MODEL,
} from './decision.constants.js';

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
