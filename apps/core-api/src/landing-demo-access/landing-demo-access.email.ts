import type { DisplayLanguage } from '../common/i18n/display-language.js';
import { DEFAULT_DISPLAY_LANGUAGE } from '../common/i18n/display-language.js';
import { formatLandingDemoMagicLinkExpiry } from '../common/i18n/email-date-format.js';
import { createEmailTranslator } from '../common/i18n/email-i18n.js';
import type { EmailDraft } from '../notifications/notification-outbox.email-columns.js';

export function renderLandingDemoMagicLinkEmail(input: {
  recipientEmail: string;
  signInUrl: string;
  validUntil: Date;
  betrieb: string;
  documentLocale?: DisplayLanguage;
}): EmailDraft {
  const documentLocale = input.documentLocale ?? DEFAULT_DISPLAY_LANGUAGE;
  const t = createEmailTranslator(documentLocale);
  const validUntilText = formatLandingDemoMagicLinkExpiry(
    documentLocale,
    input.validUntil,
  );

  const subject = t('landingDemo.magicLink.subject');
  const body = [
    t('landingDemo.magicLink.greeting'),
    '',
    t('landingDemo.magicLink.thanks', { betrieb: input.betrieb }),
    '',
    t('landingDemo.magicLink.instruction'),
    input.signInUrl,
    '',
    t('landingDemo.magicLink.validity', { validUntil: validUntilText }),
    '',
    t('landingDemo.magicLink.ignore'),
    '',
    t('landingDemo.magicLink.closing'),
    t('landingDemo.magicLink.senderName'),
  ].join('\n');

  return {
    recipientEmail: input.recipientEmail,
    subject,
    text: body,
    senderName: t('landingDemo.magicLink.senderName'),
    replyToEmail: null,
    documentLocale,
  };
}

export function renderLandingDemoOperatorAlertEmail(input: {
  operatorEmail: string;
  name: string;
  betrieb: string;
  email: string;
  telefon: string | null;
  nachricht: string | null;
  existingAccountBlocked?: boolean;
}): EmailDraft {
  const subject = `Neue Demo-Anfrage: ${input.betrieb}`;
  const lines = [
    'Neue Self-Service-Demo-Anfrage über die Landingpage:',
    '',
    `Name: ${input.name}`,
    `Betrieb: ${input.betrieb}`,
    `E-Mail: ${input.email}`,
    `Telefon: ${input.telefon ?? '—'}`,
    '',
    'Nachricht:',
    input.nachricht?.trim() ? input.nachricht.trim() : '—',
  ];

  if (input.existingAccountBlocked) {
    lines.push(
      '',
      'Hinweis: Für diese E-Mail-Adresse existiert bereits ein Konto mit weiteren Mandanten-Zugehörigkeiten. Es wurde kein Demo-Zugang angelegt und keine Magic-Link-E-Mail versendet.',
    );
  }

  return {
    recipientEmail: input.operatorEmail,
    subject,
    text: lines.join('\n'),
    senderName: 'Auto Core Platform',
    replyToEmail: null,
    documentLocale: 'de',
  };
}
