import { phoneDigitTailContainsVariants } from './customer-duplicate-check.phone-probe.js';

describe('phoneDigitTailContainsVariants', () => {
  it('includes a single-space split for each adjacent digit pair in the tail', () => {
    expect(phoneDigitTailContainsVariants('123456')).toEqual(
      expect.arrayContaining(['123456', '123 456', '12 3456']),
    );
  });
});
