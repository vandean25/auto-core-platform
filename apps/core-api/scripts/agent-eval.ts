import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecisionProvider } from '../src/decision/decision-provider.factory.js';
import type {
  AgentEvalExampleInput,
  AgentEvalMode,
} from './agent-eval.runner.js';
import {
  CONFIDENT_AUTO_THRESHOLD,
  evaluateExamples,
  redactSecretText,
} from './agent-eval.runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../test/fixtures/agent-eval/labeled-examples.jsonl');
const resultsDirectory = join(
  here,
  '../test/fixtures/agent-eval/results',
);

type CliOptions = {
  mode: AgentEvalMode;
  firstRun: number;
  runCount: number;
  outputPath: string | null;
};

type ResultDocument = {
  dataset_hash: string;
  mode: AgentEvalMode;
  run: number;
  provider: string;
  example_count: number;
  confident_auto_threshold: number;
  results: Awaited<ReturnType<typeof evaluateExamples>>;
};

async function main(args = process.argv.slice(2), env = process.env) {
  const options = parseOptions(args);
  if (options.mode !== 'rules' && !env.OPENROUTER_API_KEY?.trim()) {
    throw new Error(
      'Jev evaluation requires OPENROUTER_API_KEY in the local environment.',
    );
  }

  const rawDataset = readFileSync(fixturePath, 'utf8');
  const datasetHash = createHash('sha256').update(rawDataset).digest('hex');
  const examples = parseExamples(rawDataset);
  const provider =
    options.mode === 'rules'
      ? undefined
      : createDecisionProvider({
          ...env,
          DECISION_PROVIDER: 'openrouter-jev',
        });

  for (let run = options.firstRun; run < options.firstRun + options.runCount; run += 1) {
    const results = await evaluateExamples({
      examples,
      mode: options.mode,
      provider,
    });
    const document: ResultDocument = {
      dataset_hash: datasetHash,
      mode: options.mode,
      run,
      provider: provider?.providerId ?? 'rules',
      example_count: results.length,
      confident_auto_threshold: CONFIDENT_AUTO_THRESHOLD,
      results,
    };
    const outputPath =
      options.outputPath ?? resultFilePath(datasetHash, options.mode, run);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${options.mode} evaluation run ${run} to ${outputPath}`);
  }
}

function parseOptions(args: string[]): CliOptions {
  let mode: AgentEvalMode = 'rules';
  let firstRun = 1;
  let runCount = 1;
  let outputPath: string | null = null;
  for (const argument of args) {
    const [name, value] = argument.split('=', 2);
    if (name === '--mode' && isAgentEvalMode(value)) {
      mode = value;
    } else if (name === '--run' && isPositiveInteger(value)) {
      firstRun = Number(value);
    } else if (name === '--runs' && isPositiveInteger(value)) {
      runCount = Number(value);
    } else if (name === '--output' && value) {
      outputPath = resolve(value);
    } else {
      throw new Error(`Invalid agent-eval option: ${argument}`);
    }
  }
  if (runCount > 1 && outputPath) {
    throw new Error('--output can be used only with one run.');
  }
  return { mode, firstRun, runCount, outputPath };
}

function parseExamples(raw: string): AgentEvalExampleInput[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AgentEvalExampleInput);
}

function resultFilePath(
  datasetHash: string,
  mode: AgentEvalMode,
  run: number,
): string {
  return join(resultsDirectory, datasetHash, `${mode}-run-${run}.json`);
}

function isAgentEvalMode(value: string | undefined): value is AgentEvalMode {
  return value === 'rules' || value === 'jev' || value === 'rules+jev';
}

function isPositiveInteger(value: string | undefined): value is string {
  return value !== undefined && /^[1-9]\d*$/.test(value);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(redactSecretText(message));
  process.exitCode = 1;
});
