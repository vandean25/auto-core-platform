import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  applyBaselineUpdate,
  evaluateGate,
  formatBaselineChanges,
  formatGateReport,
  isGateSourcePath,
  parseBaseline,
  parseHealthJson,
  parseNameStatusZ,
  serializeBaseline,
  touchesGateSource,
} from './repowise-gate-lib.mjs';

const fixturesDir = path.join(import.meta.dirname, 'repowise-gate-fixtures');
const cliPath = path.join(import.meta.dirname, 'repowise-gate.mjs');
const fixturePath = (name) => path.join(fixturesDir, name);
const readFixture = (name) => fs.readFileSync(fixturePath(name), 'utf8');

const LEGACY = 'apps/core-api/src/mcp/mcp-tool-handler.service.ts';
const LEGACY_EDGE = 'apps/core-api/src/vehicle/vehicle.controller.ts';
const LEGACY_WEB = 'apps/core-web/src/pages/agent/components/ActivityTab.tsx';
const NEAR_FLOOR = 'apps/core-api/src/document-branding/document-branding-upload.service.ts';
const HEALTHY = 'apps/core-api/src/workshop/workshop-task.service.ts';
const DOC = 'docs/internal/05-Runbooks/lint-prisma-tenant.ts';

const scores = (entries) => new Map(Object.entries(entries));
const baselineOf = (files) => ({ version: 1, files });

function evaluate({ changes = [], base = {}, head = {}, baseline = {} }) {
  return evaluateGate({
    changes,
    baseScores: scores(base),
    headScores: scores(head),
    baseline: baselineOf(baseline),
  });
}

test('isGateSourcePath accepts app and tooling TypeScript and JavaScript', () => {
  for (const file of [
    LEGACY,
    'apps/core-web/src/pages/Foo.tsx',
    'apps/core-api/scripts/generate-openapi.mjs',
    'tools/repowise-gate.mjs',
  ]) {
    assert.equal(isGateSourcePath(file), true, file);
  }
});

test('isGateSourcePath skips lockfiles, docs, generated contracts, declarations and vendored skills', () => {
  for (const file of [
    'package-lock.json',
    'apps/core-api/openapi/openapi.json',
    'apps/core-web/src/api/generated/openapi.ts',
    'apps/core-api/src/types/global.d.ts',
    DOC,
    'docs/deletion-policy.md',
    '.agents/skills/superpowers/brainstorming/scripts/helper.js',
    'agents.md',
    '.repowise-baseline.json',
    'node_modules/left-pad/index.js',
  ]) {
    assert.equal(isGateSourcePath(file), false, file);
  }
});

test('touchesGateSource follows the new path of a rename and ignores docs-only edits', () => {
  assert.equal(touchesGateSource({ status: 'R', path: 'tools/new.mjs', oldPath: 'docs/old.md' }), true);
  assert.equal(touchesGateSource({ status: 'M', path: DOC }), false);
});

test('parseNameStatusZ reads added, modified, deleted and renamed entries from git -z output', () => {
  const output = [
    'A', 'tools/new.mjs',
    'M', 'apps/core-api/src/a b.ts',
    'D', 'apps/core-api/src/gone.ts',
    'R087', 'old.ts', 'new.ts',
    'C075', 'src.ts', 'copy.ts',
    'T', 'type-changed.ts',
    '',
  ].join('\0');
  assert.deepEqual(parseNameStatusZ(output), [
    { status: 'A', path: 'tools/new.mjs' },
    { status: 'M', path: 'apps/core-api/src/a b.ts' },
    { status: 'D', path: 'apps/core-api/src/gone.ts' },
    { status: 'R', path: 'new.ts', oldPath: 'old.ts' },
    { status: 'A', path: 'copy.ts' },
    { status: 'M', path: 'type-changed.ts' },
  ]);
});

test('parseHealthJson skips structlog lines before the JSON document', () => {
  const stdout = `2026-10-10 13:48:05 [debug    ] duplication_token_cache        hits=11 misses=2152\n${readFixture('health-base.json')}`;
  const healthScores = parseHealthJson(stdout);
  assert.equal(healthScores.size, 6);
  assert.equal(healthScores.get(LEGACY), 4.7);
  assert.equal(healthScores.get(HEALTHY), 10);
});

test('parseHealthJson rejects output that has no JSON document', () => {
  assert.throws(() => parseHealthJson('2026-10-10 [debug] only a log line\n'), /no JSON document/);
});

test('parseHealthJson rejects a document without a metrics array', () => {
  assert.throws(() => parseHealthJson('{\n  "kpis": {}\n}'), /metrics/);
});

test('parseHealthJson rejects scores outside the 0-10 range', () => {
  const doc = JSON.stringify({ metrics: [{ file_path: LEGACY, score: 11 }] }, null, 2);
  assert.throws(() => parseHealthJson(doc), /score/);
});

test('a legacy file that gets worse fails with its before and after scores', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 4.2 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.equal(result.violations.length, 1);
  assert.deepEqual(
    { kind: result.violations[0].kind, scope: result.violations[0].scope, path: result.violations[0].path, before: result.violations[0].before, after: result.violations[0].after },
    { kind: 'worse', scope: 'code', path: LEGACY, before: 4.7, after: 4.2 },
  );
});

test('a healthy file that drops but stays at or above 6.0 still fails, because changed files may not get worse', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: HEALTHY }],
    base: { [HEALTHY]: 10 },
    head: { [HEALTHY]: 9.6 },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'worse');
  assert.equal(result.violations[0].before, 10);
  assert.equal(result.violations[0].after, 9.6);
});

test('a healthy file that drops below the 6.0 floor is reported as below-floor', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: NEAR_FLOOR }],
    base: { [NEAR_FLOOR]: 6.1 },
    head: { [NEAR_FLOOR]: 5.8 },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'below-floor');
});

test('a legacy file outside the change set is not checked, even if its head score is lower', () => {
  const result = evaluate({
    changes: [],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 4.2 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.checked, 0);
});

test('an improved legacy file passes once the baseline records the new score', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 5.1 },
    baseline: { [LEGACY]: 5.1 },
  });
  assert.deepEqual(result.violations, []);
  assert.equal(result.expectedBaseline.get(LEGACY), 5.1);
});

test('an improved legacy file fails until the baseline records the new score', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 5.1 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].scope, 'baseline');
  assert.equal(result.violations[0].kind, 'baseline-stale');
  assert.equal(result.violations[0].before, 4.7);
  assert.equal(result.violations[0].after, 5.1);
});

test('a legacy file that reaches the floor must leave the baseline', () => {
  const stale = evaluate({
    changes: [{ status: 'M', path: LEGACY_EDGE }],
    base: { [LEGACY_EDGE]: 5.98 },
    head: { [LEGACY_EDGE]: 6.05 },
    baseline: { [LEGACY_EDGE]: 5.98 },
  });
  assert.deepEqual(stale.violations.map((v) => v.kind), ['baseline-stale']);
  assert.equal(stale.expectedBaseline.get(LEGACY_EDGE), null);

  const clean = evaluate({
    changes: [{ status: 'M', path: LEGACY_EDGE }],
    base: { [LEGACY_EDGE]: 5.98 },
    head: { [LEGACY_EDGE]: 6.05 },
  });
  assert.deepEqual(clean.violations, []);
});

test('an unchanged healthy file at exactly 6.0 passes', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: NEAR_FLOOR }],
    base: { [NEAR_FLOOR]: 6 },
    head: { [NEAR_FLOOR]: 6 },
  });
  assert.deepEqual(result.violations, []);
});

test('a new source file must score at least 6.0', () => {
  const atFloor = evaluate({
    changes: [{ status: 'A', path: 'tools/new.mjs' }],
    head: { 'tools/new.mjs': 6 },
  });
  assert.deepEqual(atFloor.violations, []);

  const belowFloor = evaluate({
    changes: [{ status: 'A', path: 'tools/new.mjs' }],
    head: { 'tools/new.mjs': 5.99 },
  });
  assert.equal(belowFloor.violations.length, 1);
  assert.equal(belowFloor.violations[0].kind, 'new-below-floor');
  assert.equal(belowFloor.violations[0].before, null);
  assert.equal(belowFloor.violations[0].after, 5.99);
});

test('a new source file that repowise does not score is skipped and reported, not failed', () => {
  const vendored = 'apps/core-api/src/vendor/vendor.service.ts';
  const result = evaluate({ changes: [{ status: 'A', path: vendored }] });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.skipped, [vendored]);
});

test('a previously scored file that repowise no longer scores fails as lost-score', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0].kind, 'lost-score');
  assert.equal(result.violations[0].before, 4.7);
});

test('a legacy file renamed to a worse score fails on the new path and names the old one', () => {
  const renamed = 'apps/core-api/src/mcp/mcp-tool-handler-v2.service.ts';
  const result = evaluate({
    changes: [{ status: 'R', path: renamed, oldPath: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [renamed]: 4.2 },
    baseline: { [LEGACY]: 4.7 },
  });
  const worse = result.violations.find((v) => v.kind === 'worse');
  assert.equal(worse.path, renamed);
  assert.equal(worse.renamedFrom, LEGACY);
  assert.equal(worse.before, 4.7);
  assert.equal(worse.after, 4.2);
});

test('a scored file moved to a path repowise does not score fails as lost-score', () => {
  const moved = 'apps/core-api/src/vendor/mcp-tool-handler.service.ts';
  const result = evaluate({
    changes: [{ status: 'R', path: moved, oldPath: LEGACY }],
    base: { [LEGACY]: 4.7 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.equal(result.violations.find((v) => v.kind === 'lost-score')?.before, 4.7);
});

test('a deleted legacy file must leave the baseline', () => {
  const stale = evaluate({
    changes: [{ status: 'D', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.deepEqual(stale.violations.map((v) => v.kind), ['baseline-stale']);

  const clean = evaluate({ changes: [{ status: 'D', path: LEGACY }], base: { [LEGACY]: 4.7 } });
  assert.deepEqual(clean.violations, []);
});

test('docs, lockfiles and generated contracts are ignored even when repowise has no score for them', () => {
  const result = evaluate({
    changes: [
      { status: 'M', path: 'docs/internal/AGENTS.md' },
      { status: 'M', path: 'package-lock.json' },
      { status: 'A', path: 'apps/core-web/src/api/generated/openapi.ts' },
    ],
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.checked, 0);
});

test('applyBaselineUpdate records improvements, drops files that reached the floor and keeps untouched entries', () => {
  const baseline = baselineOf({ [LEGACY]: 4.7, [LEGACY_EDGE]: 5.98, [LEGACY_WEB]: 4.65 });
  const evaluation = evaluate({
    changes: [
      { status: 'M', path: LEGACY },
      { status: 'M', path: LEGACY_EDGE },
    ],
    base: { [LEGACY]: 4.7, [LEGACY_EDGE]: 5.98 },
    head: { [LEGACY]: 5.1, [LEGACY_EDGE]: 6.05 },
    baseline: baseline.files,
  });
  const { baseline: next, changes } = applyBaselineUpdate(baseline, evaluation);
  assert.deepEqual(next, baselineOf({ [LEGACY]: 5.1, [LEGACY_WEB]: 4.65 }));
  assert.deepEqual(changes, [
    { path: LEGACY, from: 4.7, to: 5.1 },
    { path: LEGACY_EDGE, from: 5.98, to: null },
  ]);
});

test('applyBaselineUpdate adds an entry for a changed legacy file that was not listed', () => {
  const evaluation = evaluate({
    changes: [{ status: 'M', path: LEGACY_WEB }],
    base: { [LEGACY_WEB]: 4.65 },
    head: { [LEGACY_WEB]: 4.65 },
  });
  const { baseline: next, changes } = applyBaselineUpdate(baselineOf({}), evaluation);
  assert.deepEqual(next, baselineOf({ [LEGACY_WEB]: 4.65 }));
  assert.deepEqual(changes, [{ path: LEGACY_WEB, from: null, to: 4.65 }]);
});

test('applyBaselineUpdate refuses to record a regression', () => {
  const evaluation = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 4.2 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.throws(() => applyBaselineUpdate(baselineOf({ [LEGACY]: 4.7 }), evaluation), /code violation/);
});

test('parseBaseline rejects entries at or above the floor, which belong to healthy files', () => {
  const text = JSON.stringify({ version: 1, files: { [HEALTHY]: 10 } });
  assert.throws(() => parseBaseline(text), /below 6\.0/);
});

test('parseBaseline rejects unsupported versions', () => {
  assert.throws(() => parseBaseline(JSON.stringify({ version: 2, files: {} })), /version/);
});

test('serializeBaseline writes sorted keys with a trailing newline and round-trips', () => {
  const text = serializeBaseline(baselineOf({ 'b.ts': 5, 'a.ts': 4.5 }));
  assert.equal(text, '{\n  "version": 1,\n  "files": {\n    "a.ts": 4.5,\n    "b.ts": 5\n  }\n}\n');
  assert.deepEqual(parseBaseline(text), baselineOf({ 'a.ts': 4.5, 'b.ts': 5 }));
});

test('formatBaselineChanges prints the new value for each updated file', () => {
  const text = formatBaselineChanges([
    { path: LEGACY, from: 4.7, to: 5.1 },
    { path: LEGACY_EDGE, from: 5.98, to: null },
    { path: LEGACY_WEB, from: null, to: 4.65 },
  ]);
  assert.match(text, /mcp-tool-handler\.service\.ts: 4\.70 -> 5\.10/);
  assert.match(text, /vehicle\.controller\.ts: 5\.98 -> removed/);
  assert.match(text, /ActivityTab\.tsx: not listed -> 4\.65/);
});

test('formatGateReport lists each violating file with its before and after scores', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 4.2 },
    baseline: { [LEGACY]: 4.7 },
  });
  const report = formatGateReport(result);
  assert.match(report, /FAILED/);
  assert.match(report, new RegExp(LEGACY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(report, /before 4\.70 -> after 4\.20/);
});

test('formatGateReport reports a passing run with its checked and skipped counts', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }, { status: 'A', path: 'apps/core-api/src/vendor/x.ts' }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 4.7 },
    baseline: { [LEGACY]: 4.7 },
  });
  const report = formatGateReport(result);
  assert.match(report, /passed/);
  assert.match(report, /1 changed source file/);
  assert.match(report, /skipped/);
});

test('formatGateReport tells the developer to run --update for stale baseline entries', () => {
  const result = evaluate({
    changes: [{ status: 'M', path: LEGACY }],
    base: { [LEGACY]: 4.7 },
    head: { [LEGACY]: 5.1 },
    baseline: { [LEGACY]: 4.7 },
  });
  assert.match(formatGateReport(result), /--update/);
});

function gitIn(cwd, args) {
  const result = spawnSync(
    'git',
    ['-c', 'user.name=Repowise Gate Test', '-c', 'user.email=gate-test@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function writeFiles(dir, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(dir, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
  }
}

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repowise-gate-'));
  gitIn(dir, ['init', '-q']);
  writeFiles(dir, files);
  gitIn(dir, ['add', '-A']);
  gitIn(dir, ['commit', '-q', '-m', 'base']);
  return dir;
}

function runGate(dir, args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return { ...result, output: `${result.stdout}${result.stderr}` };
}

const BASE_FILES = {
  [LEGACY]: 'export const legacy = 1;\n',
  [LEGACY_EDGE]: 'export const lowEdge = 1;\n',
  [LEGACY_WEB]: 'export const web = 1;\n',
  [NEAR_FLOOR]: 'export const nearFloor = 1;\n',
  [HEALTHY]: 'export const healthy = 1;\n',
  [DOC]: 'docs stay outside the gate\n',
  '.repowise-baseline.json': readFixture('baseline.json'),
};

test('CLI fails with a per-file report when changed files get worse or drop below the floor', () => {
  const dir = makeRepo(BASE_FILES);
  try {
    writeFiles(dir, {
      [LEGACY]: 'export const legacy = 2;\n',
      [LEGACY_EDGE]: 'export const lowEdge = 2;\n',
      [NEAR_FLOOR]: 'export const nearFloor = 2;\n',
      [HEALTHY]: 'export const healthy = 2;\n',
      [DOC]: 'docs changed too\n',
      'tools/new-helper.mjs': 'export const helper = 1;\n',
    });
    const result = runGate(dir, [
      '--base', 'HEAD',
      '--base-health', fixturePath('health-base.json'),
      '--head-health', fixturePath('health-head-regressed.json'),
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /FAILED/);
    assert.match(result.output, /mcp-tool-handler\.service\.ts[\s\S]*before 4\.70 -> after 4\.20/);
    assert.match(result.output, /document-branding-upload\.service\.ts[\s\S]*before 6\.10 -> after 5\.80/);
    assert.match(result.output, /workshop-task\.service\.ts[\s\S]*before 10\.00 -> after 9\.60/);
    assert.match(result.output, /tools\/new-helper\.mjs[\s\S]*after 5\.20/);
    assert.match(result.output, /vehicle\.controller\.ts[\s\S]*--update/);
    assert.doesNotMatch(result.output, /ActivityTab\.tsx/);
    assert.doesNotMatch(result.output, /lint-prisma-tenant/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI --update records improved legacy scores, drops files that reached the floor and prints the new values', () => {
  const dir = makeRepo(BASE_FILES);
  try {
    writeFiles(dir, {
      [LEGACY]: 'export const legacy = 2;\n',
      [LEGACY_EDGE]: 'export const lowEdge = 2;\n',
    });
    const args = [
      '--base', 'HEAD',
      '--base-health', fixturePath('health-base.json'),
      '--head-health', fixturePath('health-head-improved.json'),
    ];

    const stale = runGate(dir, args);
    assert.equal(stale.status, 1, stale.output);
    assert.match(stale.output, /--update/);

    const update = runGate(dir, [...args, '--update']);
    assert.equal(update.status, 0, update.output);
    assert.match(update.output, /mcp-tool-handler\.service\.ts: 4\.70 -> 5\.10/);
    assert.match(update.output, /vehicle\.controller\.ts: 5\.98 -> removed/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '.repowise-baseline.json'), 'utf8')), {
      version: 1,
      files: { [LEGACY]: 5.1, [LEGACY_WEB]: 4.65 },
    });

    const recheck = runGate(dir, args);
    assert.equal(recheck.status, 0, recheck.output);
    assert.match(recheck.output, /passed/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI skips the analysis without calling repowise when no gated source file changed', () => {
  const dir = makeRepo(BASE_FILES);
  try {
    writeFiles(dir, { [DOC]: 'docs only change\n' });
    const result = runGate(dir, ['--base', 'HEAD']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /no changed source files/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI exits 2 for an unknown base ref', () => {
  const dir = makeRepo(BASE_FILES);
  try {
    const result = runGate(dir, ['--base', 'refs/heads/does-not-exist']);
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /unknown base ref/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
