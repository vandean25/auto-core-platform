import { formatNumberString } from './weekly-report-format.util.js';
import { formatSiteLocalDateTime } from './weekly-report-period.util.js';

describe('weekly-report-format.util', () => {
  it('formats parts turnover as a plain number, not EUR', () => {
    expect(formatNumberString('1.20')).toBe('1,20');
    expect(formatNumberString('1.20')).not.toContain('€');
  });
});

describe('site-local datetime formatting (late evening UTC)', () => {
  it('uses Europe/Vienna for Gesendet timestamps after 22:00 UTC', () => {
    const instant = new Date('2026-10-15T22:30:00.000Z');
    const label = formatSiteLocalDateTime(instant, 'Europe/Vienna');
    expect(label).toMatch(/16\.10\.2026/);
  });
});
