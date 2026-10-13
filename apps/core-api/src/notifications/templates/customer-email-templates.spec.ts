import { buildEmailColumns } from '../notification-outbox.email-columns.js';
import {
  CUSTOMER_TEMPLATE_IDS,
  CUSTOMER_TEMPLATE_VERSION,
  renderEstimateApprovalConfirmedEmail,
  renderEstimateSentEmail,
  renderOrderReadyEmail,
} from './customer-email-templates.js';

const RECIPIENT = {
  recipientEmail: 'max.muster@example.at',
  senderName: 'Werkstatt Muster',
  replyToEmail: 'werkstatt@example.at',
};

// 27 October 2026 is after the switch to winter time, so 09:00 UTC is 10:00 in Vienna.
const VALID_UNTIL = new Date('2026-10-27T09:00:00Z');
// 13 October 2026 is summer time, so 08:30 UTC is 10:30 in Vienna on the same day.
const APPROVED_AT = new Date('2026-10-13T08:30:00Z');

/** Informal second-person forms. The customer is addressed as Sie throughout. */
const INFORMAL_FORM = /\b(du|dich|dir|dein\w*|euch|euer\w*)\b/i;

describe('customer email templates (AUT-356 phase 3)', () => {
  it('renders the estimate-sent draft in the Sie form, with the validity date in Vienna time', () => {
    const draft = renderEstimateSentEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      vehicleLabel: 'VW Golf',
      validUntil: VALID_UNTIL,
    });

    expect(draft.subject).toBe('Kostenvoranschlag KV-2026-0001');
    expect(draft.text).toContain('Sehr geehrte Damen und Herren,');
    expect(draft.text).toContain('Ihr Fahrzeug VW Golf');
    expect(draft.text).toContain('gültig bis 27.10.2026, 10:00 Uhr');
    expect(draft.text).toMatch(/\bSie\b/);
    expect(draft.text).not.toMatch(INFORMAL_FORM);
    expect(
      draft.text.endsWith('Mit freundlichen Grüßen\nWerkstatt Muster'),
    ).toBe(true);
  });

  it('renders the approval confirmation with the approval date', () => {
    const draft = renderEstimateApprovalConfirmedEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      approvedAt: APPROVED_AT,
    });

    expect(draft.subject).toBe(
      'Bestätigung Ihrer Freigabe: Kostenvoranschlag KV-2026-0001',
    );
    expect(draft.text).toContain(
      'Freigabe des Kostenvoranschlags KV-2026-0001 am 13.10.2026.',
    );
    expect(draft.text).toMatch(/\bIhre\b/);
    expect(draft.text).not.toMatch(INFORMAL_FORM);
  });

  it('renders the order-ready draft with the vehicle and the order number', () => {
    const draft = renderOrderReadyEmail({
      ...RECIPIENT,
      orderNumber: 'WO-2026-0001',
      vehicleLabel: 'Skoda Octavia',
    });

    expect(draft.subject).toBe('Ihr Fahrzeug ist fertig: Auftrag WO-2026-0001');
    expect(draft.text).toContain('Arbeiten an Ihrem Fahrzeug Skoda Octavia');
    expect(draft.text).toContain('Sie können Ihr Fahrzeug bei uns abholen.');
    expect(draft.text).not.toMatch(INFORMAL_FORM);
  });

  it('uses a personal salutation when the caller supplies one', () => {
    const draft = renderOrderReadyEmail({
      ...RECIPIENT,
      greeting: 'Sehr geehrte Frau Muster',
      orderNumber: 'WO-2026-0001',
      vehicleLabel: 'Skoda Octavia',
    });

    expect(draft.text.startsWith('Sehr geehrte Frau Muster,\n\n')).toBe(true);
  });

  it('falls back to the neutral salutation when the greeting is blank', () => {
    const draft = renderOrderReadyEmail({
      ...RECIPIENT,
      greeting: '   ',
      orderNumber: 'WO-2026-0001',
      vehicleLabel: 'Skoda Octavia',
    });

    expect(draft.text.startsWith('Sehr geehrte Damen und Herren,\n\n')).toBe(
      true,
    );
  });

  it('marks every draft with its template id and version, and keeps the reply-to address', () => {
    const drafts = [
      renderEstimateSentEmail({
        ...RECIPIENT,
        estimateNumber: 'KV-2026-0001',
        vehicleLabel: 'VW Golf',
        validUntil: VALID_UNTIL,
      }),
      renderEstimateApprovalConfirmedEmail({
        ...RECIPIENT,
        estimateNumber: 'KV-2026-0001',
        approvedAt: APPROVED_AT,
      }),
      renderOrderReadyEmail({
        ...RECIPIENT,
        orderNumber: 'WO-2026-0001',
        vehicleLabel: 'Skoda Octavia',
      }),
    ];

    expect(drafts.map((draft) => draft.templateId)).toEqual([
      CUSTOMER_TEMPLATE_IDS.estimateSent,
      CUSTOMER_TEMPLATE_IDS.estimateApprovalConfirmed,
      CUSTOMER_TEMPLATE_IDS.orderReady,
    ]);
    for (const draft of drafts) {
      expect(draft.templateVersion).toBe(CUSTOMER_TEMPLATE_VERSION);
      expect(draft.replyToEmail).toBe(RECIPIENT.replyToEmail);
    }
  });

  it('produces drafts the outbox writer accepts, so a bad field cannot reach the worker', () => {
    const drafts = [
      renderEstimateSentEmail({
        ...RECIPIENT,
        estimateNumber: 'KV-2026-0001',
        vehicleLabel: 'VW Golf',
        validUntil: VALID_UNTIL,
      }),
      renderEstimateApprovalConfirmedEmail({
        ...RECIPIENT,
        estimateNumber: 'KV-2026-0001',
        approvedAt: APPROVED_AT,
      }),
      renderOrderReadyEmail({
        ...RECIPIENT,
        orderNumber: 'WO-2026-0001',
        vehicleLabel: 'Skoda Octavia',
      }),
    ];

    for (const draft of drafts) {
      expect(() => buildEmailColumns(draft)).not.toThrow();
    }
  });
});
