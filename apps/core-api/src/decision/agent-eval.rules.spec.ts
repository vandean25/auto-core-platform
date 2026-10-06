import { DECISION_USE_CASES } from './decision.constants.js';
import { evaluateExampleWithRules } from './agent-eval.rules.js';

describe('agent evaluation deterministic rules', () => {
  it('classifies a document with one keyword signal confidently', () => {
    const result = evaluateExampleWithRules({
      id: 'doc-demo-1',
      use_case: DECISION_USE_CASES.DOCUMENT_SORT,
      difficulty: 'easy',
      label: 'Rechnung',
      choices: ['Rechnung', 'Sonstiges'],
      input: { text: 'Rechnung DEMO-1' },
    });

    expect(result).toMatchObject({
      choice: 'Rechnung',
      confidence: 1,
      ambiguous: false,
    });
  });

  it('uses the import planner email match and marks unmatched rows ambiguous', () => {
    const matched = evaluateExampleWithRules({
      id: 'import-demo-1',
      use_case: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      difficulty: 'easy',
      label: 'candidate-1',
      choices: ['candidate-1', '__create_new__'],
      input: {
        entity_type: 'customer',
        row: {
          external_id: 'EXT-DEMO-1',
          type: 'PRIVATE',
          first_name: 'Erika',
          last_name: 'Beispiel',
          email: 'demo-1@example.org',
          address_country: 'DE',
        },
        candidates: [
          { id: 'candidate-1', email: 'demo-1@example.org' },
        ],
      },
    });

    expect(matched).toMatchObject({
      choice: 'candidate-1',
      confidence: 1,
      ambiguous: false,
    });

    const unmatched = evaluateExampleWithRules({
      id: 'import-demo-2',
      use_case: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      difficulty: 'ambiguous',
      label: 'candidate-2',
      choices: ['candidate-2', '__create_new__'],
      input: {
        entity_type: 'customer',
        row: {
          external_id: 'EXT-DEMO-2',
          type: 'PRIVATE',
          first_name: 'Max',
          last_name: 'Probe',
          email: 'row-2@example.org',
          address_country: 'DE',
        },
        candidates: [
          { id: 'candidate-2', email: 'other-2@example.org' },
        ],
      },
    });

    expect(unmatched).toMatchObject({
      choice: '__create_new__',
      confidence: 0.5,
      ambiguous: true,
    });
  });

  it('uses the vehicle import planner identifier precedence', () => {
    const result = evaluateExampleWithRules({
      id: 'import-demo-3',
      use_case: DECISION_USE_CASES.IMPORT_ROW_MATCHING,
      difficulty: 'easy',
      label: 'candidate-vin',
      choices: ['candidate-external', 'candidate-vin', '__create_new__'],
      input: {
        entity_type: 'vehicle',
        row: {
          external_id: 'EXT-DEMO-3',
          vin: `DEM${'0'.repeat(14)}`,
          plate: 'DEMO-123',
          make: 'Muster',
          model: 'Test',
          year: '2020',
        },
        candidates: [
          {
            id: 'candidate-external',
            external_id: 'EXT-DEMO-3',
            vin: `DEM${'0'.repeat(14)}`,
          },
          {
            id: 'candidate-vin',
            vin: `DEM${'0'.repeat(14)}`,
          },
        ],
      },
    });

    expect(result).toMatchObject({
      choice: 'candidate-external',
      confidence: 1,
      ambiguous: false,
    });
  });
});
