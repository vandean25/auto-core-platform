import {
  REDACTED_APPROVAL_LINK,
  redactApprovalLinks,
} from './notification-body-redaction.js';

describe('notification body redaction (ADR-0025 §7)', () => {
  it('removes the approval link and keeps the words around it', () => {
    const body = [
      'Guten Tag,',
      'Den Kostenvoranschlag können Sie unter folgendem Link einsehen: https://portal.example.at/approve/abc_DEF-123',
      'Mit freundlichen Grüßen',
    ].join('\n\n');

    expect(redactApprovalLinks(body)).toBe(
      [
        'Guten Tag,',
        `Den Kostenvoranschlag können Sie unter folgendem Link einsehen: ${REDACTED_APPROVAL_LINK}`,
        'Mit freundlichen Grüßen',
      ].join('\n\n'),
    );
  });

  it('leaves a body without an approval link unchanged', () => {
    expect(redactApprovalLinks('Die Arbeiten sind abgeschlossen.')).toBe(
      'Die Arbeiten sind abgeschlossen.',
    );
  });

  it('passes a missing body through as null', () => {
    expect(redactApprovalLinks(null)).toBeNull();
  });
});
