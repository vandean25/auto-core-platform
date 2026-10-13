import { isBmdSafeText } from './bmd-text-rules.js';

describe('bmd-text-rules', () => {
  it.each([
    ['account number', '2000'],
    ['booking text', 'RE RE-2026-0001'],
    ['credit booking text', 'CN CN-2026-0001 / RE RE-2026-0001'],
    ['parenthesis and digits', 'Konto (Debitor) 1'],
  ])('accepts printable ASCII for %s', (_label, value) => {
    expect(isBmdSafeText(value)).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['semicolon', 'a;b'],
    ['double quote', 'a"b'],
    ['line feed', 'a\nb'],
    ['carriage return', 'a\rb'],
    ['tab', 'a\tb'],
    ['leading equals sign', '=SUM(A1)'],
    ['leading plus sign', '+49'],
    ['leading minus sign', '-1'],
    ['leading at sign', '@x'],
    ['umlaut', 'Müller'],
    ['euro sign (Windows-1252 but not ASCII)', '5 €'],
  ])('rejects %s', (_label, value) => {
    expect(isBmdSafeText(value)).toBe(false);
  });
});
