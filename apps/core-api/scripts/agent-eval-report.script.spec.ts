import { readFileSync } from 'node:fs';
import {
  extractReportTables,
  loadCommittedReportInputs,
  renderReportTables,
  type AgentEvalResultDocument,
  type AgentEvalResultGroup,
} from './agent-eval-report.js';
import type { AgentEvalResultRow } from './agent-eval.runner.js';

describe('agent-eval report generator', () => {
  it('renders rules metrics and clearly marks missing Jev runs as pending', () => {
    const groups: AgentEvalResultGroup = {
      rules: [resultDocument('rules', [resultRow()])],
      jev: [],
      'rules+jev': [],
    };

    const tables = renderReportTables(groups, 'a'.repeat(64));

    expect(tables).toContain('| Rules only | all | 1 | 100.0%');
    expect(tables).toContain('| Jev only | all | pending run |');
    expect(tables).toContain('| Rules + Jev | all | pending run |');
    expect(tables).toContain('false-completion');
  });

  it('reports Jev errors caught by confident rules and estimates input-token cost', () => {
    const rule = resultRow();
    const jev = {
      ...resultRow(),
      suggestion: 'Sonstiges',
      correct: false,
      rechecked_correct: false,
      jev_suggestion: 'Sonstiges',
      confidence: 0.9,
      latency_ms: 12,
      input_tokens: 25,
      provider: 'openrouter-jev',
    };
    const groups: AgentEvalResultGroup = {
      rules: [resultDocument('rules', [rule])],
      jev: [resultDocument('jev', [jev])],
      'rules+jev': [],
    };

    const tables = renderReportTables(groups, 'b'.repeat(64));

    expect(tables).toContain(
      '| Jev only | all | 1 | 0.0% | 0.0% / — | 1 | 12.0 / 12.0 | $0.000001 |',
    );
  });

  it('reproduces the committed report tables from committed results JSON', () => {
    const inputs = loadCommittedReportInputs();
    const expectedTables = renderReportTables(
      inputs.resultGroups,
      inputs.datasetHash,
    );
    const report = readFileSync(inputs.reportPath, 'utf8');

    expect(extractReportTables(report)).toBe(expectedTables);
  });
});

function resultDocument(
  mode: AgentEvalResultDocument['mode'],
  results: AgentEvalResultRow[],
): AgentEvalResultDocument {
  return {
    dataset_hash: 'a'.repeat(64),
    mode,
    run: 1,
    provider: mode,
    example_count: results.length,
    confident_auto_threshold: 0.8,
    results,
  };
}

function resultRow(): AgentEvalResultRow {
  return {
    id: 'demo-row-1',
    use_case: 'document_sort',
    difficulty: 'easy',
    label: 'Rechnung',
    suggestion: 'Rechnung',
    correct: true,
    rechecked_correct: true,
    rule_suggestion: 'Rechnung',
    jev_suggestion: null,
    rule_confidence: 1,
    confidence: 1,
    ambiguous: false,
    tags: [],
    latency_ms: 0,
    input_tokens: null,
    output_tokens: null,
    provider: 'rules',
    error: null,
  };
}
