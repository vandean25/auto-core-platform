import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentEvalMode,
  AgentEvalResultRow,
} from './agent-eval.runner.js';
import {
  CONFIDENT_AUTO_THRESHOLD,
  isConfidentAuto,
} from './agent-eval.runner.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixturePath = join(here, '../test/fixtures/agent-eval/labeled-examples.jsonl');
const resultsRoot = join(here, '../test/fixtures/agent-eval/results');
const reportPath = join(
  here,
  '../../../docs/internal/02-Feature-Specs/Platform/agent-eval-jev-vs-rules.md',
);
const TABLE_START = '<!-- AGENT-EVAL-TABLES:START -->';
const TABLE_END = '<!-- AGENT-EVAL-TABLES:END -->';

const CONFIGURATIONS: Array<{ mode: AgentEvalMode; label: string }> = [
  { mode: 'rules', label: 'Rules only' },
  { mode: 'jev', label: 'Jev only' },
  { mode: 'rules+jev', label: 'Rules + Jev' },
];

const USE_CASES = [
  { key: 'import_row_matching', label: 'Import row matching' },
  { key: 'document_sort', label: 'Document sorting' },
] as const;

const DIFFICULTY_ROWS = [
  { key: 'all', label: 'all' },
  { key: 'easy', label: 'easy' },
  { key: 'ambiguous', label: 'ambiguous' },
  { key: 'adversarial', label: 'adversarial' },
  { key: 'false_completion', label: 'false-completion' },
] as const;

export type AgentEvalResultDocument = {
  dataset_hash: string;
  mode: AgentEvalMode;
  run: number;
  provider: string;
  example_count: number;
  confident_auto_threshold: number;
  results: AgentEvalResultRow[];
};

export type AgentEvalResultGroup = Record<AgentEvalMode, AgentEvalResultDocument[]>;

export type CommittedReportInputs = {
  datasetHash: string;
  resultGroups: AgentEvalResultGroup;
  reportPath: string;
};

export function loadCommittedReportInputs(): CommittedReportInputs {
  const datasetHash = createHash('sha256')
    .update(readFileSync(fixturePath, 'utf8').replace(/\r\n/g, '\n'))
    .digest('hex');
  const resultDirectory = join(resultsRoot, datasetHash);
  const resultGroups: AgentEvalResultGroup = {
    rules: [],
    jev: [],
    'rules+jev': [],
  };
  let files: string[] = [];
  try {
    files = readdirSync(resultDirectory);
  } catch {
    return { datasetHash, resultGroups, reportPath };
  }

  for (const file of files.filter((entry) => entry.endsWith('.json')).sort()) {
    const document = JSON.parse(
      readFileSync(join(resultDirectory, file), 'utf8'),
    ) as AgentEvalResultDocument;
    if (document.dataset_hash !== datasetHash) {
      throw new Error(`Stale agent-eval results JSON: ${file}`);
    }
    if (isAgentEvalMode(document.mode)) {
      resultGroups[document.mode].push(document);
    }
  }
  return { datasetHash, resultGroups, reportPath };
}

export function renderReportTables(
  resultGroups: AgentEvalResultGroup,
  datasetHash: string,
): string {
  const output = [
    `Dataset SHA-256: \`${datasetHash}\`.`,
    '',
    `Confident auto uses confidence ≥ ${CONFIDENT_AUTO_THRESHOLD.toFixed(2)}. Precision is the correct share of confident suggestions; recall is the share of all correct examples that were confidently suggested. “Wrong Jev suggestions rules would catch” counts incorrect Jev choices where the rules choice is correct and has confidence ≥ ${CONFIDENT_AUTO_THRESHOLD.toFixed(2)}. Cost uses input tokens at $0.042 per million; output tokens are free. When provider usage is missing, serialized decision input is estimated at about four characters per token and the cost is marked (est.).`,
  ];

  for (const useCase of USE_CASES) {
    output.push('', `### ${useCase.label}`, '');
    output.push(
      '| Configuration | Difficulty/tag | N | Accuracy | Confident auto P / R | Wrong Jev suggestions rules would catch | Latency p50 / p95 (ms) | Estimated input cost |',
      '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const configuration of CONFIGURATIONS) {
      const allRows = resultGroups[configuration.mode].flatMap((document) =>
        document.results.filter((result) => result.use_case === useCase.key),
      );
      for (const difficulty of DIFFICULTY_ROWS) {
        const rows = filterRows(allRows, difficulty.key);
        if (rows.length === 0) {
          output.push(
            `| ${configuration.label} | ${difficulty.label} | pending run | — | — | — | — | — |`,
          );
          continue;
        }
        const metrics = calculateMetrics(
          rows,
          configuration.mode,
          resultGroups.rules.flatMap((document) => document.results),
        );
        output.push(
          `| ${configuration.label} | ${difficulty.label} | ${rows.length} | ${percentage(metrics.accuracy)} | ${percentage(metrics.precision)} / ${percentage(metrics.recall)} | ${metrics.caughtWrongJevSuggestions} | ${metricPair(metrics.p50, metrics.p95)} | ${formatCost(metrics.inputCost, metrics.inputCostEstimated)} |`,
        );
      }
    }
  }

  output.push(
    '',
    '### Three-run stability and false-completion check',
    '',
    `Confident-auto accuracy is measured only among suggestions with confidence ≥ ${CONFIDENT_AUTO_THRESHOLD.toFixed(2)}; spread is the highest minus lowest run value. False-completion counts show incorrect suggestions over the tagged examples in each run: per-use-case denominators are /6 and combined denominators are /12.`,
    '',
    '| Configuration | Use case | Run 1 confident-auto accuracy | Run 2 confident-auto accuracy | Run 3 confident-auto accuracy | Confident-auto accuracy spread | False-completion incorrect / run |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  );
  for (const configuration of CONFIGURATIONS.filter(({ mode }) => mode !== 'rules')) {
    const documents = [...resultGroups[configuration.mode]].sort(
      (left, right) => left.run - right.run,
    );
    for (const useCase of USE_CASES) {
      const runRows = documents.slice(0, 3).map((document) =>
        document.results.filter((row) => row.use_case === useCase.key),
      );
      const runAccuracyCells = [0, 1, 2].map((index) =>
        percentage(confidentAutoAccuracy(runRows[index] ?? [])),
      );
      output.push(
        `| ${configuration.label} | ${useCase.label} | ${runAccuracyCells.join(' | ')} | ${accuracySpread(runRows)} | ${runRows.map((rows) => formatFalseCompletionCount(rows)).join(' / ') || '—'} |`,
      );
    }
    const runRows = documents.slice(0, 3).map((document) => document.results);
    output.push(
      `| ${configuration.label} | Both use cases | — | — | — | — | ${runRows.map((rows) => formatFalseCompletionCount(rows)).join(' / ') || '—'} |`,
    );
  }

  return output.join('\n');
}

export function extractReportTables(report: string): string {
  const start = report.indexOf(TABLE_START);
  const end = report.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Report is missing agent-eval table markers.');
  }
  return report.slice(start + TABLE_START.length + 1, end - 1);
}

export function generateReport(): string {
  const inputs = loadCommittedReportInputs();
  const tables = renderReportTables(inputs.resultGroups, inputs.datasetHash);
  const report = readFileSync(inputs.reportPath, 'utf8');
  const start = report.indexOf(TABLE_START);
  const end = report.indexOf(TABLE_END);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Report is missing agent-eval table markers.');
  }
  const updated = `${report.slice(0, start + TABLE_START.length)}\n${tables}\n${report.slice(end)}`;
  writeFileSync(inputs.reportPath, updated, 'utf8');
  return tables;
}

type Metrics = {
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  caughtWrongJevSuggestions: number | string;
  p50: number | null;
  p95: number | null;
  inputCost: number | null;
  inputCostEstimated: boolean;
};

function calculateMetrics(
  rows: AgentEvalResultRow[],
  mode: AgentEvalMode,
  rulesRows: AgentEvalResultRow[],
): Metrics {
  const correctRows = rows.filter((row) => row.rechecked_correct);
  const confidentRows = rows.filter(isConfidentAuto);
  const confidentCorrectRows = confidentRows.filter(
    (row) => row.rechecked_correct,
  );
  const latencies = rows
    .map((row) => row.latency_ms)
    .filter((latency): latency is number =>
      typeof latency === 'number' && Number.isFinite(latency),
    );
  const providerRows = rows.filter((row) => row.provider !== 'rules');
  const tokenCounts = providerRows.map((row) => {
    if (isValidTokenCount(row.input_tokens)) {
      return { count: row.input_tokens, estimated: false };
    }
    if (isValidTokenCount(row.estimated_input_tokens)) {
      return { count: row.estimated_input_tokens, estimated: true };
    }
    return null;
  });
  const inputCostEstimated = tokenCounts.some((count) => count?.estimated);
  const inputCost =
    mode === 'rules'
      ? 0
      : tokenCounts.length === 0
        ? 0
        : tokenCounts.every((count) => count !== null)
          ? (tokenCounts.reduce((sum, count) => sum + (count?.count ?? 0), 0) *
              0.042) /
            1_000_000
          : null;

  return {
    accuracy: correctRows.length / rows.length,
    precision:
      confidentRows.length === 0
        ? null
        : confidentCorrectRows.length / confidentRows.length,
    recall:
      correctRows.length === 0
        ? null
        : confidentCorrectRows.length / correctRows.length,
    caughtWrongJevSuggestions:
      mode === 'rules'
        ? '—'
        : countWrongJevSuggestionsCaught(rows, rulesRows),
    p50: percentile(latencies, 0.5),
    p95: percentile(latencies, 0.95),
    inputCost,
    inputCostEstimated,
  };
}

function countWrongJevSuggestionsCaught(
  rows: AgentEvalResultRow[],
  rulesRows: AgentEvalResultRow[],
): number {
  const rulesById = new Map(rulesRows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    const rule = rulesById.get(row.id);
    return (
      row.jev_suggestion !== null &&
      row.jev_suggestion !== row.label &&
      rule?.rechecked_correct === true &&
      rule.confidence !== null &&
      isConfidentAuto(rule)
    );
  }).length;
}

function filterRows(
  rows: AgentEvalResultRow[],
  difficulty: string,
): AgentEvalResultRow[] {
  if (difficulty === 'all') {
    return rows;
  }
  if (difficulty === 'false_completion') {
    return rows.filter((row) => row.tags.includes('false_completion'));
  }
  return rows.filter((row) => row.difficulty === difficulty);
}

function percentile(values: number[], percentileValue: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileValue;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const weight = position - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
}

function percentage(value: number | null): string {
  return value === null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function metricPair(p50: number | null, p95: number | null): string {
  if (p50 === null || p95 === null) {
    return '—';
  }
  return `${p50.toFixed(1)} / ${p95.toFixed(1)}`;
}

function formatCost(value: number | null, estimated = false): string {
  if (value === null) {
    return 'n/a';
  }
  return `$${value.toFixed(6)}${estimated ? ' (est.)' : ''}`;
}

function isValidTokenCount(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function accuracy(rows: AgentEvalResultRow[]): number | null {
  return rows.length === 0
    ? null
    : rows.filter((row) => row.rechecked_correct).length / rows.length;
}

function accuracySpread(runs: AgentEvalResultRow[][]): string {
  const values = runs
    .map(confidentAutoAccuracy)
    .filter((value): value is number => value !== null);
  return values.length === 0
    ? '—'
    : `${((Math.max(...values) - Math.min(...values)) * 100).toFixed(1)} pp`;
}

function confidentAutoAccuracy(rows: AgentEvalResultRow[]): number | null {
  return accuracy(rows.filter(isConfidentAuto));
}

function formatFalseCompletionCount(rows: AgentEvalResultRow[]): string {
  const taggedRows = rows.filter((row) => row.tags.includes('false_completion'));
  const incorrectCount = taggedRows.filter((row) => !row.rechecked_correct).length;
  return `${incorrectCount}/${taggedRows.length}`;
}

function isAgentEvalMode(value: string): value is AgentEvalMode {
  return value === 'rules' || value === 'jev' || value === 'rules+jev';
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(here, 'agent-eval-report.ts')) {
  try {
    generateReport();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]'));
    process.exitCode = 1;
  }
}
