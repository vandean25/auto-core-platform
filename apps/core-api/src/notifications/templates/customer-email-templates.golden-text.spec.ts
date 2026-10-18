import {
  emailLocaleString,
  loadEmailLocaleJson,
} from '../../common/i18n/email-locale-test-helpers.js';
import {
  formatWorkshopEstimateDate,
  formatWorkshopEstimateValidUntil,
} from '../../workshop/workshop-estimate-snapshot.js';
import { renderLandingDemoMagicLinkEmail } from '../../landing-demo-access/landing-demo-access.email.js';
import {
  renderEstimateApprovalConfirmedEmail,
  renderEstimateSentEmail,
  renderOrderReadyEmail,
} from './customer-email-templates.js';

const RECIPIENT = {
  recipientEmail: 'max.muster@example.at',
  senderName: 'Werkstatt Muster',
  replyToEmail: 'werkstatt@example.at',
};

const APPROVAL_URL = 'https://portal.example.at/approve/demo-token';
const VALID_UNTIL = new Date('2026-10-27T09:00:00Z');
const APPROVED_AT = new Date('2026-10-13T22:30:00Z');

describe('customer email templates golden text (AUT-588)', () => {
  const deEmail = loadEmailLocaleJson('de');
  const enEmail = loadEmailLocaleJson('en');

  it('renders German estimate-sent copy from locales/de/email.json', () => {
    const draft = renderEstimateSentEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      vehicleLabel: 'VW Golf',
      approvalUrl: APPROVAL_URL,
      validUntil: VALID_UNTIL,
      documentLocale: 'de',
    });

    expect(draft.subject).toBe(
      emailLocaleString(deEmail, 'customer.estimateSent.subject').replace(
        '{{estimateNumber}}',
        'KV-2026-0001',
      ),
    );
    expect(draft.text).toContain(
      emailLocaleString(deEmail, 'shared.defaultGreeting'),
    );
    expect(draft.text).toContain(
      emailLocaleString(deEmail, 'customer.estimateSent.intro')
        .replace('{{vehicleLabel}}', 'VW Golf')
        .replace('{{estimateNumber}}', 'KV-2026-0001'),
    );
    expect(draft.text).toContain(
      `gültig bis ${formatWorkshopEstimateValidUntil(VALID_UNTIL)} Uhr`,
    );
    expect(draft.documentLocale).toBe('de');
    expect(draft).toMatchSnapshot();
  });

  it('renders English estimate-sent copy from locales/en/email.json', () => {
    const draft = renderEstimateSentEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      vehicleLabel: 'VW Golf',
      approvalUrl: APPROVAL_URL,
      validUntil: VALID_UNTIL,
      documentLocale: 'en',
    });

    expect(draft.subject).toBe('Estimate KV-2026-0001');
    expect(draft.text).toContain(
      emailLocaleString(enEmail, 'shared.defaultGreeting'),
    );
    expect(draft.text).toContain(
      emailLocaleString(enEmail, 'customer.estimateSent.intro')
        .replace('{{vehicleLabel}}', 'VW Golf')
        .replace('{{estimateNumber}}', 'KV-2026-0001'),
    );
    expect(draft.documentLocale).toBe('en');
    expect(draft).toMatchSnapshot();
  });

  it('renders German and English order-ready emails from email.json', () => {
    const deDraft = renderOrderReadyEmail({
      ...RECIPIENT,
      orderNumber: 'WO-2026-0001',
      vehicleLabel: 'Skoda Octavia',
      documentLocale: 'de',
    });
    const enDraft = renderOrderReadyEmail({
      ...RECIPIENT,
      orderNumber: 'WO-2026-0001',
      vehicleLabel: 'Skoda Octavia',
      documentLocale: 'en',
    });

    expect(deDraft.text).toContain(
      emailLocaleString(deEmail, 'customer.orderReady.body').replace(
        '{{vehicleLabel}}',
        'Skoda Octavia',
      ),
    );
    expect(enDraft.text).toContain(
      emailLocaleString(enEmail, 'customer.orderReady.body').replace(
        '{{vehicleLabel}}',
        'Skoda Octavia',
      ),
    );
    expect(deDraft).toMatchSnapshot();
    expect(enDraft).toMatchSnapshot();
  });

  it('renders approval confirmation dates from email.json in de and en', () => {
    const deDraft = renderEstimateApprovalConfirmedEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      approvedAt: APPROVED_AT,
      documentLocale: 'de',
    });
    const enDraft = renderEstimateApprovalConfirmedEmail({
      ...RECIPIENT,
      estimateNumber: 'KV-2026-0001',
      approvedAt: APPROVED_AT,
      documentLocale: 'en',
    });

    expect(deDraft.text).toContain(
      `am ${formatWorkshopEstimateDate(APPROVED_AT)}.`,
    );
    expect(enDraft.text).toContain(
      `on ${formatWorkshopEstimateDate(APPROVED_AT)}.`,
    );
    expect(deDraft).toMatchSnapshot();
    expect(enDraft).toMatchSnapshot();
  });

  it('renders landing demo magic-link emails from email.json', () => {
    const validUntil = new Date('2026-10-27T09:00:00Z');
    const deDraft = renderLandingDemoMagicLinkEmail({
      recipientEmail: 'demo@example.com',
      signInUrl: 'https://app.example/sign-in',
      validUntil,
      betrieb: 'Example Workshop',
      documentLocale: 'de',
    });
    const enDraft = renderLandingDemoMagicLinkEmail({
      recipientEmail: 'demo@example.com',
      signInUrl: 'https://app.example/sign-in',
      validUntil,
      betrieb: 'Example Workshop',
      documentLocale: 'en',
    });

    expect(deDraft.subject).toBe(
      emailLocaleString(deEmail, 'landingDemo.magicLink.subject'),
    );
    expect(enDraft.subject).toBe(
      emailLocaleString(enEmail, 'landingDemo.magicLink.subject'),
    );
    expect(deDraft).toMatchSnapshot();
    expect(enDraft).toMatchSnapshot();
  });
});
