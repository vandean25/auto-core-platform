import {
  FOOTER_DECORATIVE_WIDTH_MM,
  HEADER_DECORATIVE_WIDTH_MM,
  wrapAndEllipsizeDecorativeText,
} from './decorative-text-layout.js';

describe('wrapAndEllipsizeDecorativeText', () => {
  it('leaves text unchanged when it fits on one line', () => {
    expect(wrapAndEllipsizeDecorativeText(
      'Workshop',
      HEADER_DECORATIVE_WIDTH_MM,
      2,
    )).toEqual({
      lines: ['Workshop'],
      truncated: false,
    });
  });

  it('wraps and appends a visible ellipsis when text exceeds two header lines', () => {
    const result = wrapAndEllipsizeDecorativeText(
      'Workshop & North '.repeat(8).slice(0, 120),
      HEADER_DECORATIVE_WIDTH_MM,
      2,
    );

    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatch(/^Workshop & North/);
    expect(result.lines[1]).toMatch(/…$/);
    expect(result.truncated).toBe(true);
  });

  it('keeps one measured footer line and appends an ellipsis when it overflows', () => {
    const result = wrapAndEllipsizeDecorativeText(
      'Service footer '.repeat(12),
      FOOTER_DECORATIVE_WIDTH_MM,
      1,
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatch(/^Service footer/);
    expect(result.lines[0]).toMatch(/…$/);
    expect(result.truncated).toBe(true);
  });
});
