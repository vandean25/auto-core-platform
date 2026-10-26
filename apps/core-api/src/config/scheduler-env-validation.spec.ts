import { z } from 'zod';
import {
  addSchedulerEnvValidationIssues,
  isPlaceholderCronOidcValue,
} from './scheduler-env-validation.js';

function collectIssues(env: Record<string, string | undefined>) {
  const schema = z.object({}).superRefine((_parsed, ctx) => {
    addSchedulerEnvValidationIssues(ctx, env);
  });
  const result = schema.safeParse({});
  return result.success ? [] : result.error.issues;
}

describe('scheduler env validation', () => {
  it('allows unset SCHEDULER_MODE with legacy SCHEDULER_ENABLED=false', () => {
    const issues = collectIssues({ SCHEDULER_ENABLED: 'false' });
    expect(issues).toHaveLength(0);
  });

  it('rejects unknown explicit SCHEDULER_MODE values', () => {
    const issues = collectIssues({ SCHEDULER_MODE: 'typo-mode' });
    expect(issues.some((i) => i.path[0] === 'SCHEDULER_MODE')).toBe(true);
  });

  it('requires non-placeholder OIDC env when SCHEDULER_MODE is http', () => {
    const missing = collectIssues({ SCHEDULER_MODE: 'http' });
    expect(missing.map((i) => i.path[0]).sort()).toEqual([
      'CRON_INVOKER_SA_EMAIL',
      'CRON_OIDC_AUDIENCE',
    ]);

    const placeholder = collectIssues({
      SCHEDULER_MODE: 'http',
      CRON_OIDC_AUDIENCE: 'PLACEHOLDER_CORE_API_RUN_APP_URL',
      CRON_INVOKER_SA_EMAIL: 'PLACEHOLDER_CLOUD_SCHEDULER_INVOKER_SA_EMAIL',
    });
    expect(placeholder.every((i) => i.message === 'invalid')).toBe(true);
  });
});

describe('isPlaceholderCronOidcValue', () => {
  it('detects placeholder prefixes case-insensitively', () => {
    expect(isPlaceholderCronOidcValue('PLACEHOLDER_x')).toBe(true);
    expect(isPlaceholderCronOidcValue(' placeholder ')).toBe(true);
    expect(isPlaceholderCronOidcValue('https://core-api.example.run.app')).toBe(
      false,
    );
  });
});
