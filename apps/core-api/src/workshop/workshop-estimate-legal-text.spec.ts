import {
  WORKSHOP_ESTIMATE_LEGAL_TEXT_VERSION,
  buildWorkshopEstimateLegalBlock,
} from './workshop-estimate-legal-text.js';

describe('workshop estimate legal block', () => {
  it('always states the estimate is non-binding and uses the Sie-form', () => {
    const block = buildWorkshopEstimateLegalBlock({
      freeOfCharge: true,
      validUntilLabel: '24.10.2026, 10:00',
    });
    const text = block.paragraphs.join(' ');

    expect(block.text_version).toBe(WORKSHOP_ESTIMATE_LEGAL_TEXT_VERSION);
    expect(text).toContain('unverbindlich');
    expect(text).toContain('Sie');
    expect(text).toContain('Gültig bis 24.10.2026, 10:00 Uhr.');
  });

  it('never carries an up-to-15-percent-without-notice sentence', () => {
    const text = buildWorkshopEstimateLegalBlock({
      freeOfCharge: true,
      validUntilLabel: '24.10.2026',
    }).paragraphs.join(' ');

    expect(text).not.toMatch(/15\s?%/);
    expect(text).not.toContain('ohne Ankündigung');
  });

  it('changes its hash when the validity date or the wording changes', () => {
    const first = buildWorkshopEstimateLegalBlock({
      freeOfCharge: true,
      validUntilLabel: '24.10.2026',
    });
    const again = buildWorkshopEstimateLegalBlock({
      freeOfCharge: true,
      validUntilLabel: '24.10.2026',
    });
    const later = buildWorkshopEstimateLegalBlock({
      freeOfCharge: true,
      validUntilLabel: '25.10.2026',
    });

    expect(first.text_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(again.text_sha256).toBe(first.text_sha256);
    expect(later.text_sha256).not.toBe(first.text_sha256);
  });
});
