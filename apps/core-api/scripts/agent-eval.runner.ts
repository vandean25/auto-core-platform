import type { DecisionUseCase } from '../src/decision/decision.constants.js';
import type { DecisionProvider } from '../src/decision/decision-provider.js';
import type { DecisionResult } from '../src/decision/decision.types.js';
import {
  evaluateExampleWithRules,
  type AgentEvalExample,
} from '../src/decision/agent-eval.rules.js';

export type AgentEvalMode = 'rules' | 'jev' | 'rules+jev';

export type AgentEvalExampleInput = AgentEvalExample & {
  use_case: DecisionUseCase;
  tags?: string[];
};

export type AgentEvalResultRow = {
  id: string;
  use_case: DecisionUseCase;
  difficulty: string;
  label: string;
  suggestion: string | null;
  correct: boolean;
  rechecked_correct: boolean;
  rule_suggestion: string;
  jev_suggestion: string | null;
  rule_confidence: number;
  confidence: number | null;
  ambiguous: boolean;
  tags: string[];
  latency_ms: number | null;
  input_tokens: number | null;
  estimated_input_tokens: number | null;
  output_tokens: number | null;
  provider: string;
  error: string | null;
};

export type EvaluateExamplesInput = {
  examples: AgentEvalExampleInput[];
  mode: AgentEvalMode;
  provider?: DecisionProvider;
};

export const CONFIDENT_AUTO_THRESHOLD = 0.8;

export async function evaluateExamples({
  examples,
  mode,
  provider,
}: EvaluateExamplesInput): Promise<AgentEvalResultRow[]> {
  if (mode !== 'rules' && !provider) {
    throw new Error(`Mode ${mode} requires a decision provider`);
  }

  const results: AgentEvalResultRow[] = [];
  for (const example of examples) {
    results.push(await evaluateExample(example, mode, provider));
  }
  return results;
}

async function evaluateExample(
  example: AgentEvalExampleInput,
  mode: AgentEvalMode,
  provider: DecisionProvider | undefined,
): Promise<AgentEvalResultRow> {
  const ruleStartedAt = performance.now();
  const ruleDecision = evaluateExampleWithRules(example);
  const ruleLatencyMs = performance.now() - ruleStartedAt;
  const shouldAskJev =
    mode === 'jev' || (mode === 'rules+jev' && ruleDecision.ambiguous);
  const decision = shouldAskJev
    ? await askJev(example, provider!)
    : { result: null, error: null };
  const suggestion = chooseSuggestion(mode, ruleDecision.choice, decision.result);
  const confidence = decision.result
    ? (decision.result.confidence ?? null)
    : suggestion === ruleDecision.choice
      ? ruleDecision.confidence
      : null;
  const recheckedCorrect =
    suggestion !== null &&
    example.choices.includes(suggestion) &&
    suggestion === example.label;

  return {
    id: example.id,
    use_case: example.use_case,
    difficulty: example.difficulty,
    label: example.label,
    suggestion,
    correct: recheckedCorrect,
    rechecked_correct: recheckedCorrect,
    rule_suggestion: ruleDecision.choice,
    jev_suggestion: decision.result?.choice ?? null,
    rule_confidence: ruleDecision.confidence,
    confidence,
    ambiguous: ruleDecision.ambiguous,
    tags: example.tags ?? [],
    latency_ms: decision.result?.latency_ms ?? (shouldAskJev ? null : ruleLatencyMs),
    input_tokens: decision.result?.input_tokens ?? null,
    estimated_input_tokens:
      decision.result?.estimated_input_tokens ?? null,
    output_tokens: decision.result?.output_tokens ?? null,
    provider: resultProvider(mode, decision.result),
    error: decision.error,
  };
}

async function askJev(
  example: AgentEvalExampleInput,
  provider: DecisionProvider,
): Promise<{ result: DecisionResult | null; error: string | null }> {
  try {
    return {
      result: await provider.decide({
        useCase: example.use_case,
        input: example.input,
        choices: example.choices,
      }),
      error: null,
    };
  } catch (caught) {
    return {
      result: null,
      error: redactSecretText(
        caught instanceof Error ? caught.message : String(caught),
      ),
    };
  }
}

export function redactSecretText(value: string): string {
  const configuredKey = process.env.OPENROUTER_API_KEY;
  const withoutConfiguredKey = configuredKey
    ? value.replaceAll(configuredKey, '[REDACTED]')
    : value;
  return withoutConfiguredKey.replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]');
}

function chooseSuggestion(
  mode: AgentEvalMode,
  ruleSuggestion: string,
  jevDecision: DecisionResult | null,
): string | null {
  if (mode === 'rules') {
    return ruleSuggestion;
  }
  if (mode === 'jev') {
    return jevDecision?.choice ?? null;
  }
  return jevDecision?.choice ?? ruleSuggestion;
}

function resultProvider(
  mode: AgentEvalMode,
  decision: DecisionResult | null,
): string {
  if (mode === 'rules') {
    return 'rules';
  }
  if (mode === 'rules+jev' && !decision) {
    return 'rules';
  }
  return decision?.provider ?? 'openrouter-jev';
}

export function isConfidentAuto(result: AgentEvalResultRow): boolean {
  return result.confidence !== null && result.confidence >= CONFIDENT_AUTO_THRESHOLD;
}
