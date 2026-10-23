import { parseSearchQuery } from './search-query.parser.js';

describe('parseSearchQuery', () => {
  it.each([
    ['3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b', 'uuid'],
    ['3F2B8C1E-9A4D-4E6F-8B1A-2C3D4E5F6A7B', 'uuid'],
    ['max@example.com', 'email'],
    ['max@exa', 'email'],
    ['WVWZZZ1KZAW123456', 'vin'],
    ['+43 664 1234567', 'phone'],
    ['0664/1234567', 'phone'],
    ['0043 664 123', 'phone'],
    ['RE-2026-0012', 'number'],
    ['wo-2026-1', 'number'],
    ['WO-SRCH-77-1', 'number'],
    ['Anna-Maria', 'name'],
    ['4711', 'number'],
    ['7', 'number'],
    ['123456', 'number'],
    ['W 12345 A', 'plate'],
    ['W-12345A', 'plate'],
    ['g.123.ab', 'plate'],
    ['Max Mustermann', 'name'],
    ['  Müller   GmbH ', 'name'],
    ['golf', 'name'],
  ])('detects %p as %s', (input, kind) => {
    expect(parseSearchQuery(input).kind).toBe(kind);
  });

  it('normalises a plate with spaces, hyphens and dots', () => {
    expect(parseSearchQuery('w 12345 a').plate).toBe('W12345A');
    expect(parseSearchQuery('W-12345-A').plate).toBe('W12345A');
    expect(parseSearchQuery('W.12345.A').plate).toBe('W12345A');
  });

  it('keeps a plate candidate for short document-number-like input', () => {
    const parsed = parseSearchQuery('AB-123');
    expect(parsed.kind).toBe('number');
    expect(parsed.plate).toBe('AB123');
  });

  it('has no plate for names, numbers and emails', () => {
    expect(parseSearchQuery('Max Mustermann').plate).toBeNull();
    expect(parseSearchQuery('4711').plate).toBeNull();
    expect(parseSearchQuery('a1@b.c').plate).toBeNull();
  });

  it('keeps an upper-cased VIN fragment of 6 to 17 characters', () => {
    expect(parseSearchQuery('zzz1kzaw123456').vin).toBe('ZZZ1KZAW123456');
    expect(parseSearchQuery('WVWZZZ1KZAW123456').vin).toBe('WVWZZZ1KZAW123456');
    expect(parseSearchQuery('12345').vin).toBeNull();
    expect(parseSearchQuery('ABCDEQ').vin).toBeNull(); // Q is not a VIN character
    expect(parseSearchQuery('W 12345 A').vin).toBeNull();
    expect(parseSearchQuery('x'.repeat(18)).vin).toBeNull();
  });

  it('splits a multi-word name into terms and collapses whitespace', () => {
    const parsed = parseSearchQuery('  max   mustermann ');
    expect(parsed.text).toBe('max mustermann');
    expect(parsed.terms).toEqual(['max', 'mustermann']);
  });

  it('treats a 17-digit input as a number, not a VIN', () => {
    expect(parseSearchQuery('12345678901234567').kind).toBe('number');
  });
});
