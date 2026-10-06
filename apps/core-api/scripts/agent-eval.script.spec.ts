import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsxCliPath = fileURLToPath(import.meta.resolve('tsx/cli'));

describe('agent-eval script', () => {
  it('writes stable rules results without using an environment-selected Jev provider', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'agent-eval-'));
    const outputPath = join(tempDirectory, 'rules-results.json');
    try {
      execFileSync(
        process.execPath,
        [
          tsxCliPath,
          'scripts/agent-eval.ts',
          '--mode=rules',
          `--output=${outputPath}`,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DECISION_PROVIDER: 'openrouter-jev',
            OPENROUTER_API_KEY: 'test-value-only',
          },
          stdio: 'pipe',
        },
      );
      const payload = JSON.parse(readFileSync(outputPath, 'utf8')) as {
        dataset_hash: string;
        mode: string;
        run: number;
        provider: string;
        results: Array<{
          suggestion: string | null;
          label: string;
          rechecked_correct: boolean;
        }>;
      };
      expect(payload.mode).toBe('rules');
      expect(payload.run).toBe(1);
      expect(payload.provider).toBe('rules');
      expect(payload.dataset_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(payload.results.length).toBe(200);
      expect(payload.results[0].suggestion).toBe('__create_new__');
      expect(payload.results[0].rechecked_correct).toBe(true);
    } finally {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
  });
});
