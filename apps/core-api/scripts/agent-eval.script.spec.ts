import { mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsxCliPath = fileURLToPath(import.meta.resolve('tsx/cli'));

describe('agent-eval script', () => {
  const resultsDir = join(process.cwd(), 'agent-eval-results');

  afterEach(() => {
    rmSync(resultsDir, { recursive: true, force: true });
  });

  it('writes results JSON using the noop provider', () => {
    process.env.DECISION_PROVIDER = 'noop';
    execFileSync(
      process.execPath,
      [tsxCliPath, 'scripts/agent-eval.ts'],
      {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'pipe',
      },
    );
    const resultFiles = readdirSync(resultsDir);
    expect(resultFiles.length).toBeGreaterThan(0);
    const payload = JSON.parse(
      readFileSync(join(resultsDir, resultFiles[0]), 'utf8'),
    ) as {
      provider: string;
      results: Array<{ suggestion: string | null; label: string }>;
    };
    expect(payload.provider).toBe('noop');
    expect(payload.results.length).toBeGreaterThan(0);
    expect(payload.results[0].suggestion).toBeNull();
  });
});
