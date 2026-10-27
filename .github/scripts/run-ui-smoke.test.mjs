import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('.github/scripts/run-ui-smoke.sh');
const posix = (path) => process.platform === 'win32' ? `/${path[0].toLowerCase()}${path.slice(2).replaceAll('\\', '/')}` : path;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';

function runScenario(failures) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-smoke-'));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), `#!/bin/bash\ncount=0\n[ ! -f count ] || count=$(cat count)\ncount=$((count + 1))\necho "$count" > count\nmkdir -p apps/core-web/playwright-report\necho "attempt $count" > apps/core-web/playwright-report/result.txt\n[ "$count" -gt "${failures}" ]\n`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/bash\nexit 0\n', { mode: 0o755 });
  const summary = join(dir, 'summary');
  const result = spawnSync(bash, ['-c', 'export PATH="$1:$PATH"; exec bash "$2" 1 3', 'test', posix(bin), posix(script)], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { ...process.env, GITHUB_STEP_SUMMARY: posix(summary) } });
  const firstReport = join(dir, 'apps/core-web/first-attempt/playwright-report/result.txt');
  const output = { status: result.status, stdout: result.stdout, stderr: result.stderr, summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '', first: existsSync(firstReport) ? readFileSync(firstReport, 'utf8').trim() : null };
  rmSync(dir, { recursive: true, force: true });
  return output;
}

test('first attempt success does not warn or save a failure report', () => {
  const result = runScenario(0);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /::warning::/);
  assert.equal(result.first, null);
});

test('a successful retry warns and preserves the first report', () => {
  const result = runScenario(1);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /::warning::/);
  assert.match(result.summary, /retry/i);
  assert.equal(result.first, 'attempt 1');
});

test('two failed attempts fail and preserve the first report', () => {
  const result = runScenario(2);
  assert.notEqual(result.status, 0);
  assert.equal(result.first, 'attempt 1');
});
