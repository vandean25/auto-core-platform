export type SchedulerMode = 'in-process' | 'http' | 'off';

const SCHEDULER_MODE_VALUES: readonly SchedulerMode[] = [
  'in-process',
  'http',
  'off',
];

function parseExplicitSchedulerMode(
  raw: string | undefined,
): SchedulerMode | undefined {
  const normalized = raw?.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === 'in-process' || normalized === 'in_process') {
    return 'in-process';
  }
  if ((SCHEDULER_MODE_VALUES as readonly string[]).includes(normalized)) {
    return normalized as SchedulerMode;
  }
  return undefined;
}

/** When `SCHEDULER_MODE` is unset/blank, returns `unset`; otherwise parsed or `invalid`. */
export function schedulerModeWhenSet(
  raw: string | undefined,
): 'unset' | SchedulerMode | 'invalid' {
  if (!raw?.trim()) {
    return 'unset';
  }
  const parsed = parseExplicitSchedulerMode(raw);
  return parsed ?? 'invalid';
}

/**
 * Resolves how core-api runs scheduled jobs (AUT-715).
 * Default is in-process. When `SCHEDULER_MODE` is unset, `SCHEDULER_ENABLED=false`
 * still means off (pdf-worker compat until Infra migrates cloudbuild).
 */
type SchedulerEnv = {
  SCHEDULER_MODE?: string;
  SCHEDULER_ENABLED?: string;
};

export function resolveSchedulerMode(
  env: SchedulerEnv & Record<string, unknown> = process.env,
): SchedulerMode {
  const explicit = parseExplicitSchedulerMode(
    typeof env.SCHEDULER_MODE === 'string' ? env.SCHEDULER_MODE : undefined,
  );
  if (explicit) {
    return explicit;
  }
  const schedulerEnabled =
    typeof env.SCHEDULER_ENABLED === 'string'
      ? env.SCHEDULER_ENABLED
      : undefined;
  if (schedulerEnabled?.trim().toLowerCase() === 'false') {
    return 'off';
  }
  return 'in-process';
}

export function isInProcessSchedulerMode(
  env: SchedulerEnv & Record<string, unknown> = process.env,
): boolean {
  return resolveSchedulerMode(env) === 'in-process';
}

export function isSchedulerModeHttp(
  env: SchedulerEnv & Record<string, unknown> = process.env,
): boolean {
  return resolveSchedulerMode(env) === 'http';
}
