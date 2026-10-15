import type { EmailDraft } from '../notifications/notification-outbox.email-columns.js';

export function renderLandingDemoMagicLinkEmail(input: {
  recipientEmail: string;
  signInUrl: string;
  validUntil: Date;
  betrieb: string;
}): EmailDraft {
  const validUntilText = input.validUntil.toLocaleString('de-AT', {
    timeZone: 'Europe/Vienna',
    dateStyle: 'long',
    timeStyle: 'short',
  });

  const subject = 'Ihr Demo-Zugang zur Auto Core Platform';
  const body = [
    'Guten Tag,',
    '',
    `vielen Dank für Ihr Interesse an der Auto Core Platform (${input.betrieb}).`,
    '',
    'Öffnen Sie den folgenden einmaligen Anmeldelink, um die Demo zu starten:',
    input.signInUrl,
    '',
    `Der Link ist bis ${validUntilText} gültig und führt Sie ohne Passwort direkt in die Demo-Umgebung.`,
    '',
    'Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.',
    '',
    'Freundliche Grüße',
    'Auto Core Platform',
  ].join('\n');

  return {
    recipientEmail: input.recipientEmail,
    subject,
    text: body,
    senderName: 'Auto Core Platform',
    replyToEmail: null,
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
  };
}
