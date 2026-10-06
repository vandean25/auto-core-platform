import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDecisionProvider } from '../src/decision/decision-provider.factory.js';
import type { DecisionUseCase } from '../src/decision/decision.constants.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, '../test/fixtures/agent-eval/labeled-examples.jsonl');

type EvalExample = {
  id: string;
  use_case: DecisionUseCase;
  difficulty: string;
  label: string;
  choices: string[];
  input: unknown;
};

type EvalResultRow = {
  id: string;
  use_case: string;
  difficulty: string;
  label: string;
  suggestion: string | null;
  correct: boolean;
  latency_ms: number | null;
  provider: string;
  error: string | null;
};

async function main() {
  const provider = createDecisionProvider(process.env);
  const raw = readFileSync(fixturePath, 'utf8');
  const examples = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvalExample);

  const results: EvalResultRow[] = [];
  for (const example of examples) {
    let suggestion: string | null = null;
    let latency_ms: number | null = null;
    let error: string | null = null;
    try {
      const decision = await provider.decide({
        useCase: example.use_case,
        input: example.input,
        choices: example.choices,
      });
      if (decision) {
        suggestion = decision.choice;
        latency_ms = decision.latency_ms;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    results.push({
      id: example.id,
      use_case: example.use_case,
      difficulty: example.difficulty,
      label: example.label,
      suggestion,
      correct: suggestion === example.label,
      latency_ms,
      provider: provider.providerId,
      error,
    });
  }

  const outDir = join(process.cwd(), 'agent-eval-results');
  mkdirSync(outDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(outDir, `results-${timestamp}.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        provider: provider.providerId,
        example_count: results.length,
        results,
      },
      null,
      2,
    ),
    'utf8',
  );
  console.log(`Wrote agent eval results to ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
