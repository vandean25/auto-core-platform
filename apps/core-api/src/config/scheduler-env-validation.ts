import type { z } from 'zod';
import {
  resolveSchedulerMode,
  schedulerModeWhenSet,
} from '../scheduler/scheduler-mode.js';
type SchedulerEnvKey =
  'SCHEDULER_MODE' | 'CRON_OIDC_AUDIENCE' | 'CRON_INVOKER_SA_EMAIL';

const REQUIRED_ISSUE = 'Required';
const INVALID_ISSUE = 'invalid';

export type SchedulerEnvSlice = {
  SCHEDULER_MODE?: string;
  SCHEDULER_ENABLED?: string;
  CRON_OIDC_AUDIENCE?: string;
  CRON_INVOKER_SA_EMAIL?: string;
};

export function addSchedulerEnvValidationIssues(
  ctx: z.RefinementCtx,
  env: SchedulerEnvSlice,
): void {
  addExplicitSchedulerModeIssues(ctx, env.SCHEDULER_MODE);
  addHttpCronOidcEnvIssues(ctx, env);
}

function addExplicitSchedulerModeIssues(
  ctx: z.RefinementCtx,
  rawMode: string | undefined,
): void {
  const whenSet = schedulerModeWhenSet(rawMode);
  if (whenSet === 'invalid') {
    addInvalidIssue(ctx, 'SCHEDULER_MODE');
  }
}

function addHttpCronOidcEnvIssues(
  ctx: z.RefinementCtx,
  env: SchedulerEnvSlice,
): void {
  if (resolveSchedulerMode(env) !== 'http') {
    return;
  }
  addRequiredCronOidcValue(ctx, 'CRON_OIDC_AUDIENCE', env.CRON_OIDC_AUDIENCE);
  addRequiredCronOidcValue(
    ctx,
    'CRON_INVOKER_SA_EMAIL',
    env.CRON_INVOKER_SA_EMAIL,
  );
}

function addRequiredCronOidcValue(
  ctx: z.RefinementCtx,
  key: SchedulerEnvKey,
  value: string | undefined,
): void {
  if (!value) {
    addRequiredIssue(ctx, key);
    return;
  }
  if (isPlaceholderCronOidcValue(value)) {
    addInvalidIssue(ctx, key);
  }
}

export function isPlaceholderCronOidcValue(value: string): boolean {
  return value.trim().toUpperCase().startsWith('PLACEHOLDER');
}

function addRequiredIssue(ctx: z.RefinementCtx, key: SchedulerEnvKey): void {
  ctx.addIssue({
    code: 'custom',
    path: [key],
    message: REQUIRED_ISSUE,
    continue: true,
  });
}

function addInvalidIssue(ctx: z.RefinementCtx, key: SchedulerEnvKey): void {
  ctx.addIssue({
    code: 'custom',
    path: [key],
    message: INVALID_ISSUE,
    continue: true,
  });
}
