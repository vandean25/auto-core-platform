import type { DecisionUseCase } from './decision.constants.js';

export type DecisionChoiceInput = {
  useCase: DecisionUseCase;
  input: unknown;
  choices: string[];
  context?: Record<string, unknown>;
};

export type DecisionResult = {
  choice: string;
  confidence?: number;
  rationale?: string;
  raw_ref: string;
  latency_ms: number;
  provider: string;
  model: string;
  input_tokens?: number;
  output_tokens?: number;
};

export type DecisionActualOutcome = {
  choice: string;
  rationale?: string;
  source?: string;
};

export type DecisionShadowRecordParams = {
  tenantId: string;
  traceId: string;
  useCase: DecisionUseCase;
  input: unknown;
  choices: string[];
  actualOutcome: DecisionActualOutcome;
};
