import path from 'node:path';

/**
 * Repowise health gate rules (AUT-462). Pure logic: the CLI in
 * `tools/repowise-gate.mjs` does the git and repowise I/O.
 *
 * - Changed source files may not score lower than on the base branch.
 * - New source files must score at least MIN_SCORE.
 * - Legacy files (below MIN_SCORE) are ratcheted by `.repowise-baseline.json`:
 *   every changed file must have its baseline entry equal to its head score,
 *   or be absent when the head score is at or above MIN_SCORE.
 */

export const MIN_SCORE = 6;
export const BASELINE_FILE = '.repowise-baseline.json';
export const UPDATE_COMMAND = 'npm run repowise:gate -- --update';

const BASELINE_VERSION = 1;
const MIN_HUNDREDTHS = Math.round(MIN_SCORE * 100);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const EXCLUDED_SEGMENTS = new Set(['node_modules', 'dist', 'coverage', 'generated', '.repowise']);
const EXCLUDED_PREFIXES = ['docs/', '.agents/'];

/** repowise reports two decimals; compare at that resolution to avoid float noise. */
const hundredths = (score) => Math.round(score * 100);

/**
 * @param {string} relativePath forward-slash path relative to the repo root
 * @returns {boolean} true when repowise scores this kind of file and the gate should apply
 */
export function isGateSourcePath(relativePath) {
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(relativePath))) {
    return false;
  }
  if (relativePath.endsWith('.d.ts')) {
    return false;
  }
  if (EXCLUDED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) {
    return false;
  }
  return !relativePath.split('/').some((segment) => EXCLUDED_SEGMENTS.has(segment));
}

/**
 * @param {{ status: string, path: string, oldPath?: string }} change
 * @returns {boolean}
 */
export function touchesGateSource(change) {
  return isGateSourcePath(change.path) || (change.oldPath !== undefined && isGateSourcePath(change.oldPath));
}

/**
 * Parses `git diff --name-status -z` output. Copies are treated as additions and
 * type changes as modifications.
 *
 * @param {string} output
 * @returns {Array<{ status: 'A' | 'M' | 'D' | 'R', path: string, oldPath?: string }>}
 */
export function parseNameStatusZ(output) {
  const tokens = output.split('\0');
  const changes = [];
  let index = 0;
  const next = () => {
    if (index >= tokens.length) {
      throw new Error('malformed git name-status output');
    }
    return tokens[index++];
  };

  while (index < tokens.length) {
    const code = next();
    if (code === '') {
      continue;
    }
    const kind = code[0];
    if (kind === 'R') {
      const oldPath = next();
      changes.push({ status: 'R', path: next(), oldPath });
    } else if (kind === 'C') {
      next();
      changes.push({ status: 'A', path: next() });
    } else {
      changes.push({ status: kind === 'T' ? 'M' : kind, path: next() });
    }
  }
  return changes;
}

/**
 * Reads `repowise health --format json` stdout. repowise writes structlog lines
 * to stdout ahead of the document, so parsing starts at the first line that is
 * exactly `{`.
 *
 * @param {string} stdout
 * @returns {Map<string, number>} repo-relative path -> score
 */
export function parseHealthJson(stdout) {
  const lines = stdout.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trimEnd() === '{');
  if (start === -1) {
    throw new Error('repowise health output contains no JSON document');
  }

  let document;
  try {
    document = JSON.parse(lines.slice(start).join('\n'));
  } catch (error) {
    throw new Error(`repowise health output is not valid JSON: ${error.message}`);
  }
  if (!Array.isArray(document?.metrics)) {
    throw new Error('repowise health JSON has no metrics array');
  }

  const scores = new Map();
  for (const metric of document.metrics) {
    if (typeof metric?.file_path !== 'string' || typeof metric.score !== 'number' || metric.score < 0 || metric.score > 10) {
      throw new Error(`repowise health metric has an invalid score: ${JSON.stringify(metric)}`);
    }
    scores.set(metric.file_path, metric.score);
  }
  return scores;
}

/**
 * @param {string} text
 * @returns {{ version: number, files: Record<string, number> }}
 */
export function parseBaseline(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error(`${BASELINE_FILE} is not valid JSON: ${error.message}`);
  }
  if (document?.version !== BASELINE_VERSION) {
    throw new Error(`${BASELINE_FILE} has unsupported version: ${document?.version}`);
  }
  if (!document.files || typeof document.files !== 'object' || Array.isArray(document.files)) {
    throw new Error(`${BASELINE_FILE} files must be an object keyed by path`);
  }
  for (const [filePath, score] of Object.entries(document.files)) {
    if (typeof score !== 'number' || score < 0 || hundredths(score) >= MIN_HUNDREDTHS) {
      throw new Error(
        `${BASELINE_FILE} lists ${filePath} with score ${score}; only legacy files below ${MIN_SCORE.toFixed(1)} belong in the baseline`,
      );
    }
  }
  return { version: BASELINE_VERSION, files: document.files };
}

/**
 * @param {{ version: number, files: Record<string, number> }} baseline
 * @returns {string} JSON with sorted keys and a trailing newline
 */
export function serializeBaseline(baseline) {
  const files = {};
  for (const filePath of Object.keys(baseline.files).sort()) {
    files[filePath] = baseline.files[filePath];
  }
  return `${JSON.stringify({ version: BASELINE_VERSION, files }, null, 2)}\n`;
}

/**
 * @typedef {{
 *   kind: 'worse' | 'below-floor' | 'new-below-floor' | 'lost-score' | 'baseline-stale',
 *   scope: 'code' | 'baseline',
 *   path: string,
 *   before: number | null,
 *   after: number | null,
 *   message: string,
 *   renamedFrom?: string,
 * }} GateViolation
 */

/**
 * @param {{
 *   changes: Array<{ status: string, path: string, oldPath?: string }>,
 *   baseScores: Map<string, number>,
 *   headScores: Map<string, number>,
 *   baseline: { files: Record<string, number> },
 * }} input
 * @returns {{
 *   violations: GateViolation[],
 *   skipped: string[],
 *   checked: number,
 *   expectedBaseline: Map<string, number | null>,
 * }}
 */
export function evaluateGate({ changes, baseScores, headScores, baseline }) {
  const violations = [];
  const skipped = [];
  const expectedBaseline = new Map();
  let checked = 0;

  const expectBaseline = (filePath, score) => {
    expectedBaseline.set(filePath, score !== undefined && hundredths(score) < MIN_HUNDREDTHS ? score : null);
  };

  for (const change of changes) {
    if (!touchesGateSource(change)) {
      continue;
    }

    const filePath = change.path;
    const oldPath = change.oldPath;
    const renamedFrom = oldPath === undefined ? undefined : { renamedFrom: oldPath };
    if (oldPath !== undefined) {
      expectBaseline(oldPath, undefined);
    }
    if (change.status === 'D') {
      expectBaseline(filePath, undefined);
      continue;
    }

    const before = baseScores.get(oldPath ?? filePath);
    const after = headScores.get(filePath);

    if (before === undefined) {
      if (after === undefined) {
        skipped.push(filePath);
        expectBaseline(filePath, undefined);
        continue;
      }
      checked += 1;
      expectBaseline(filePath, after);
      if (hundredths(after) < MIN_HUNDREDTHS) {
        violations.push({
          kind: 'new-below-floor',
          scope: 'code',
          path: filePath,
          before: null,
          after,
          message: `new source files must score at least ${MIN_SCORE.toFixed(1)}`,
          ...renamedFrom,
        });
      }
      continue;
    }

    if (after === undefined) {
      expectBaseline(filePath, undefined);
      violations.push({
        kind: 'lost-score',
        scope: 'code',
        path: filePath,
        before,
        after: null,
        message: 'repowise no longer scores this file, so the gate cannot check it; keep it in a scored path',
        ...renamedFrom,
      });
      continue;
    }

    checked += 1;
    expectBaseline(filePath, after);
    if (hundredths(after) < hundredths(before)) {
      const crossesFloor = hundredths(before) >= MIN_HUNDREDTHS && hundredths(after) < MIN_HUNDREDTHS;
      violations.push({
        kind: crossesFloor ? 'below-floor' : 'worse',
        scope: 'code',
        path: filePath,
        before,
        after,
        message: crossesFloor
          ? `dropped below the ${MIN_SCORE.toFixed(1)} floor; healthy files must stay at or above it`
          : 'score decreased; changed files must not get worse',
        ...renamedFrom,
      });
    }
  }

  const codePaths = new Set(violations.map((violation) => violation.path));
  for (const [filePath, expected] of expectedBaseline) {
    if (codePaths.has(filePath)) {
      continue;
    }
    const listed = Object.hasOwn(baseline.files, filePath) ? baseline.files[filePath] : undefined;
    if (expected === null && listed !== undefined) {
      violations.push(baselineViolation(filePath, listed, null, 'deleted, renamed or healthy files must leave the baseline'));
    } else if (expected !== null && (listed === undefined || hundredths(listed) !== hundredths(expected))) {
      const message = listed === undefined
        ? 'legacy file is not listed in the baseline'
        : `baseline lists ${listed.toFixed(2)} but the head scores ${expected.toFixed(2)}`;
      violations.push(baselineViolation(filePath, listed ?? null, expected, message));
    }
  }

  return { violations, skipped, checked, expectedBaseline };
}

function baselineViolation(filePath, before, after, message) {
  return { kind: 'baseline-stale', scope: 'baseline', path: filePath, before, after, message };
}

/**
 * Applies the baseline entries the evaluation expects for the files the change touched.
 * Refuses when any code violation remains, so `--update` can never bless a regression.
 *
 * @param {{ version: number, files: Record<string, number> }} baseline
 * @param {ReturnType<typeof evaluateGate>} evaluation
 * @returns {{ baseline: { version: number, files: Record<string, number> }, changes: Array<{ path: string, from: number | null, to: number | null }> }}
 */
export function applyBaselineUpdate(baseline, evaluation) {
  if (evaluation.violations.some((violation) => violation.scope === 'code')) {
    throw new Error('refusing to update the baseline while code violations remain; fix them first');
  }

  const files = { ...baseline.files };
  const changes = [];
  for (const filePath of [...evaluation.expectedBaseline.keys()].sort()) {
    const from = Object.hasOwn(files, filePath) ? files[filePath] : null;
    const to = evaluation.expectedBaseline.get(filePath);
    if (from === null && to === null) {
      continue;
    }
    if (from !== null && to !== null && hundredths(from) === hundredths(to)) {
      continue;
    }
    if (to === null) {
      delete files[filePath];
    } else {
      files[filePath] = to;
    }
    changes.push({ path: filePath, from, to });
  }
  return { baseline: { version: BASELINE_VERSION, files }, changes };
}

/**
 * @param {Array<{ path: string, from: number | null, to: number | null }>} changes
 * @returns {string}
 */
export function formatBaselineChanges(changes) {
  return changes
    .map(({ path: filePath, from, to }) => {
      const before = from === null ? 'not listed' : from.toFixed(2);
      const after = to === null ? 'removed' : to.toFixed(2);
      return `  ${filePath}: ${before} -> ${after}`;
    })
    .join('\n');
}

const formatScore = (score, absent) => (score === null ? absent : score.toFixed(2));

/**
 * @param {ReturnType<typeof evaluateGate>} evaluation
 * @returns {string}
 */
export function formatGateReport(evaluation) {
  const lines = [];
  if (evaluation.violations.length === 0) {
    lines.push(`Repowise health gate passed: ${evaluation.checked} changed source file(s) checked.`);
  } else {
    lines.push(`Repowise health gate FAILED: ${evaluation.violations.length} violation(s).`);
  }

  for (const violation of evaluation.violations.filter((item) => item.scope === 'code')) {
    const renamed = violation.renamedFrom === undefined ? '' : ` (renamed from ${violation.renamedFrom})`;
    lines.push(
      '',
      `  ✖ ${violation.path}${renamed}`,
      `      before ${formatScore(violation.before, 'none (new file)')} -> after ${formatScore(violation.after, 'none (not scored)')}`,
      `      ${violation.message}`,
    );
  }

  for (const violation of evaluation.violations.filter((item) => item.scope === 'baseline')) {
    lines.push(
      '',
      `  ✖ ${violation.path} (${BASELINE_FILE})`,
      `      ${violation.message}; run \`${UPDATE_COMMAND}\` and commit ${BASELINE_FILE}`,
    );
  }

  if (evaluation.skipped.length > 0) {
    lines.push('', `Not scored by repowise (skipped, not gated): ${evaluation.skipped.length} file(s)`);
    for (const filePath of evaluation.skipped) {
      lines.push(`  - ${filePath}`);
    }
  }
  return lines.join('\n');
}
