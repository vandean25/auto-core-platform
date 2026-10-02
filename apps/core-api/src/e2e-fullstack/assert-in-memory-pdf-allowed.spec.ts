import { assertE2eFullstackInMemoryPdfAllowed } from './assert-in-memory-pdf-allowed.js';

describe('assertE2eFullstackInMemoryPdfAllowed', () => {
  it('allows in-memory PDF storage in test mode', () => {
    expect(() =>
      assertE2eFullstackInMemoryPdfAllowed('test', true),
    ).not.toThrow();
  });

  it('rejects in-memory PDF storage outside test mode', () => {
    expect(() =>
      assertE2eFullstackInMemoryPdfAllowed('production', true),
    ).toThrow(/NODE_ENV=test/);
  });
});
