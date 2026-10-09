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

  it('uses the serialized-input estimate when provider usage is absent', () => {
    const jev = Object.assign(resultRow(), {
      estimated_input_tokens: 25,
      provider: 'openrouter-jev',
    });
    const groups: AgentEvalResultGroup = {
      rules: [],
      jev: [resultDocument('jev', [jev])],
      'rules+jev': [],
    };

    const tables = renderReportTables(groups, 'c'.repeat(64));

    expect(tables).toContain('$0.000001 (est.)');
  });

  it('generates run-level false-completion counts with per-case denominators', () => {
    const groups: AgentEvalResultGroup = {
      rules: [],
      jev: [
        resultDocument('jev', [
          { ...falseCompletionRow('import-1-1', 'import_row_matching', false), confidence: 0.5 },
          falseCompletionRow('import-1-2', 'import_row_matching', true),
          falseCompletionRow('doc-1-1', 'document_sort', true),
          falseCompletionRow('doc-1-2', 'document_sort', true),
        ], 1),
        resultDocument('jev', [
          falseCompletionRow('import-2-1', 'import_row_matching', true),
          falseCompletionRow('import-2-2', 'import_row_matching', true),
          falseCompletionRow('doc-2-1', 'document_sort', false),
          falseCompletionRow('doc-2-2', 'document_sort', true),
        ], 2),
        resultDocument('jev', [
          { ...falseCompletionRow('import-3-1', 'import_row_matching', false), confidence: 0.5 },
          falseCompletionRow('import-3-2', 'import_row_matching', true),
          falseCompletionRow('doc-3-1', 'document_sort', false),
          falseCompletionRow('doc-3-2', 'document_sort', true),
        ], 3),
      ],
      'rules+jev': [],
    };

    const tables = renderReportTables(groups, 'd'.repeat(64));

    expect(tables).toContain('### Three-run stability and false-completion check');
    expect(tables).toContain(
      '| Jev only | Import row matching | 100.0% | 100.0% | 100.0% | 0.0 pp | 1/2 / 0/2 / 1/2 |',
    );
    expect(tables).toContain(
      '| Jev only | Both use cases | — | — | — | — | 1/4 / 1/4 / 2/4 |',
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

  it('extracts committed report tables when the file uses Windows line endings', () => {
    const inputs = loadCommittedReportInputs();
    const expectedTables = renderReportTables(
      inputs.resultGroups,
      inputs.datasetHash,
    );
    const report = readFileSync(inputs.reportPath, 'utf8').replace(/\r?\n/g, '\r\n');

    expect(extractReportTables(report)).toBe(expectedTables);
  });
});

function resultDocument(
  mode: AgentEvalResultDocument['mode'],
  results: AgentEvalResultRow[],
  run = 1,
): AgentEvalResultDocument {
  return {
    dataset_hash: 'a'.repeat(64),
    mode,
    run,
    provider: mode,
    example_count: results.length,
    confident_auto_threshold: 0.8,
    results,
  };
}

function falseCompletionRow(
  id: string,
  useCase: AgentEvalResultRow['use_case'],
  recheckedCorrect: boolean,
): AgentEvalResultRow {
  return {
    ...resultRow(),
    id,
    use_case: useCase,
    rechecked_correct: recheckedCorrect,
    correct: recheckedCorrect,
    tags: ['false_completion'],
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
    estimated_input_tokens: null,
    provider: 'rules',
    error: null,
  };
}
