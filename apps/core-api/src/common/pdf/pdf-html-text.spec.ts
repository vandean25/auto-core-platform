import { extractVisibleTextFromHtml } from './pdf-html-text.js';

describe('extractVisibleTextFromHtml', () => {
  it('removes style and script blocks and tags', () => {
    const html = `
      <style>.x { color: red; }</style>
      <script>alert(1)</script>
      <p>Hello <strong>world</strong></p>
    `;
    expect(extractVisibleTextFromHtml(html)).toBe('Hello world');
  });

  it('handles script close tags with trailing whitespace', () => {
    const html = '<script>bad()</script >after';
    expect(extractVisibleTextFromHtml(html)).toBe('after');
  });
});
