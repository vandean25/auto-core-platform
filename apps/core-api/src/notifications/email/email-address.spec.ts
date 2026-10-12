import { isPlainEmailAddress } from './email-address.js';

describe('isPlainEmailAddress()', () => {
  it('accepts ordinary addresses and the atext characters a customer may use', () => {
    expect(isPlainEmailAddress('kunde@example.at')).toBe(true);
    expect(isPlainEmailAddress("o'brien@example.at")).toBe(true);
    expect(isPlainEmailAddress('werkstatt.nord+termine@ma.example.co.at')).toBe(
      true,
    );
  });

  it('refuses the characters that some relays route inside an address', () => {
    expect(isPlainEmailAddress('victim%attacker.example@allowed.example')).toBe(
      false,
    );
    expect(isPlainEmailAddress('victim!attacker@allowed.example')).toBe(false);
    expect(isPlainEmailAddress('victim|attacker@allowed.example')).toBe(false);
  });

  it('refuses anything that could name a second recipient or break a header', () => {
    expect(isPlainEmailAddress('kunde@example.at, victim@evil.example')).toBe(
      false,
    );
    expect(isPlainEmailAddress('kunde@example.at kunde@evil.example')).toBe(
      false,
    );
    expect(isPlainEmailAddress('"kunde"@example.at')).toBe(false);
    expect(isPlainEmailAddress('<kunde@example.at>')).toBe(false);
    expect(isPlainEmailAddress('kunde(at)example.at')).toBe(false);
    expect(isPlainEmailAddress('.kunde@example.at')).toBe(false);
    expect(isPlainEmailAddress('kunde..x@example.at')).toBe(false);
    expect(isPlainEmailAddress('kunde@example')).toBe(false);
  });
});
