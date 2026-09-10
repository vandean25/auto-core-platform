import {
  escapeHtml,
  buildBasePdfStyles,
  buildPdfTableStyles,
  buildPdfFooterTemplate,
} from './pdf-layout';

describe('pdf-layout helpers', () => {
  describe('escapeHtml', () => {
    it('returns empty string for null and undefined', () => {
      expect(escapeHtml(null)).toBe('');
      expect(escapeHtml(undefined)).toBe('');
    });

    it('escapes HTML special characters in strings', () => {
      expect(escapeHtml('<div>"Hello" & \'World\'</div>')).toBe(
        '&lt;div&gt;&quot;Hello&quot; &amp; &#39;World&#39;&lt;/div&gt;',
      );
    });

    it('handles numbers, booleans, and bigints', () => {
      expect(escapeHtml(42)).toBe('42');
      expect(escapeHtml(true)).toBe('true');
      expect(escapeHtml(BigInt(100))).toBe('100');
    });

    it('handles Date instances as ISO strings', () => {
      const date = new Date('2026-04-01T00:00:00.000Z');
      expect(escapeHtml(date)).toBe('2026-04-01T00:00:00.000Z');
    });

    it('handles objects via JSON serialization', () => {
      expect(escapeHtml({ foo: 'bar' })).toBe(
        '{&quot;foo&quot;:&quot;bar&quot;}',
      );
    });
  });

  describe('buildPdfTableStyles', () => {
    it('returns shared table CSS declarations', () => {
      const styles = buildPdfTableStyles();
      expect(styles).toContain('width: 100%');
      expect(styles).toContain('border-collapse: collapse');
      expect(styles).toContain('display: table-header-group');
      expect(styles).toContain('break-inside: avoid');
      expect(styles).toContain('border-bottom: 1px solid #d1d5db');
      expect(styles).toContain('border-bottom: 1px solid #f3f4f6');
    });
  });

  describe('buildBasePdfStyles', () => {
    it('returns base CSS style declarations including table styles', () => {
      const styles = buildBasePdfStyles();
      expect(styles).toContain('box-sizing: border-box');
      expect(styles).toContain('.section');
      expect(styles).toContain('.section-title');
      expect(styles).toContain('border-collapse: collapse');
      expect(styles).toContain('display: table-header-group');
    });
  });

  describe('buildPdfFooterTemplate', () => {
    it('renders footer markup with provided title', () => {
      const template = buildPdfFooterTemplate('Job Card WO-1');
      expect(template).toContain('Job Card WO-1');
      expect(template).toContain('class="pageNumber"');
      expect(template).toContain('class="totalPages"');
    });
  });
});
