import { classifyDocumentTextHeuristic } from './document-sort.heuristic.js';

describe('classifyDocumentTextHeuristic', () => {
  it('classifies common German document cues', () => {
    expect(classifyDocumentTextHeuristic('Rechnung Nr. DEMO-1')).toBe('Rechnung');
    expect(classifyDocumentTextHeuristic('Lieferschein LS-DEMO')).toBe(
      'Lieferschein',
    );
    expect(classifyDocumentTextHeuristic('Kostenvoranschlag Reparatur')).toBe(
      'Kostenvoranschlag',
    );
    expect(classifyDocumentTextHeuristic('Zulassungsbescheinigung Teil I')).toBe(
      'Fahrzeugschein',
    );
    expect(classifyDocumentTextHeuristic('Memo ohne Typ')).toBe('Sonstiges');
  });
});
