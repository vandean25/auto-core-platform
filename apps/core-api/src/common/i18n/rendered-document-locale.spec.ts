import { documentLocaleFrozenForCurrentRenderers } from './rendered-document-locale.js';

describe('documentLocaleFrozenForCurrentRenderers', () => {
  it('returns de for legacy PDF snapshot renders without bundle metadata', () => {
    expect(documentLocaleFrozenForCurrentRenderers()).toBe('de');
  });
});
