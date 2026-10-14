import { confirmationAfterEmailWrite } from './customer-contact-email.js';

describe('confirmationAfterEmailWrite (ADR-0025 §8)', () => {
  it('withdraws the confirmation when a write changes the address', () => {
    expect(
      confirmationAfterEmailWrite('a@example.at', {
        email: 'typo@example.at',
      }),
    ).toBe(false);
  });

  it('withdraws the confirmation when a write clears the address', () => {
    expect(confirmationAfterEmailWrite('a@example.at', { email: null })).toBe(
      false,
    );
  });

  it('keeps the confirmation when the address is unchanged, or absent from the write', () => {
    expect(
      confirmationAfterEmailWrite('a@example.at', { email: 'a@example.at' }),
    ).toBeUndefined();
    expect(
      confirmationAfterEmailWrite('a@example.at', { email: undefined }),
    ).toBeUndefined();
    expect(confirmationAfterEmailWrite(null, { email: null })).toBeUndefined();
  });

  it('leaves the flag to a write that sets it itself', () => {
    expect(
      confirmationAfterEmailWrite('a@example.at', {
        email: 'typo@example.at',
        contact_email_ok: true,
      }),
    ).toBeUndefined();
  });

  it('withdraws the confirmation for an address value that is not a string', () => {
    expect(
      confirmationAfterEmailWrite('a@example.at', { email: { set: 'b@x.at' } }),
    ).toBe(false);
  });
});
