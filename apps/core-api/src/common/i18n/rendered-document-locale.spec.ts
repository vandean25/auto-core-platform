import { documentLocaleFrozenForCurrentRenderers } from './rendered-document-locale.js';

describe('documentLocaleFrozenForCurrentRenderers', () => {
  it('returns de until PDF and email renderers use translated templates', () => {
    expect(documentLocaleFrozenForCurrentRenderers()).toBe('de');
  });
});
