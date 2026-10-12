import {
  findInvalidAllowlistEntries,
  isRecipientAllowlisted,
  parseRecipientAllowlist,
} from './recipient-allowlist.js';

describe('recipient allowlist', () => {
  it('parses a comma list case-insensitively and ignores blanks', () => {
    expect(
      parseRecipientAllowlist(' Kunde@Example.AT , ,*@test.example.at '),
    ).toEqual(['kunde@example.at', '*@test.example.at']);
    expect(parseRecipientAllowlist(undefined)).toEqual([]);
    expect(parseRecipientAllowlist('  ')).toEqual([]);
  });

  it('matches an exact address, and a domain only with the *@ form', () => {
    const list = ['kunde@example.at', '*@test.example.at'];

    expect(isRecipientAllowlisted('Kunde@example.at', list)).toBe(true);
    expect(isRecipientAllowlisted('andere@example.at', list)).toBe(false);
    expect(isRecipientAllowlisted('wer@test.example.at', list)).toBe(true);
    expect(isRecipientAllowlisted('wer@sub.test.example.at', list)).toBe(false);
  });

  it('sends to nobody when the list is empty', () => {
    expect(isRecipientAllowlisted('kunde@example.at', [])).toBe(false);
  });

  it('never allowlists a value that names more than one address', () => {
    const list = ['*@allowed.example.at', 'kunde@example.at'];

    expect(
      isRecipientAllowlisted('victim@evil.example, a@allowed.example.at', list),
    ).toBe(false);
    expect(
      isRecipientAllowlisted('kunde@example.at, victim@evil.example', list),
    ).toBe(false);
    expect(isRecipientAllowlisted('<kunde@example.at>', list)).toBe(false);
  });

  it('rejects malformed entries so a typo fails boot', () => {
    expect(
      findInvalidAllowlistEntries(['ok@example.at', '*@', 'not-an-address']),
    ).toEqual(['*@', 'not-an-address']);
  });
});
