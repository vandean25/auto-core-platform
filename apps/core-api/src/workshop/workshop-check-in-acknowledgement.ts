/**
 * Frozen check-in signature acknowledgement copy (simple e-signature for evidence only, not QES).
 * Must match locales/{de,en}/workshop.json `checkIn.review.signatureAcknowledgementLabel` exactly.
 * TODO(legal-review): replace with counsel-approved DE/EN wording before production customer use.
 */
export const CHECK_IN_ACKNOWLEDGEMENT_VERSION = 'check-in-signature-v1';

export type CheckInAcknowledgementLocale = 'de' | 'en';

/** Canonical German text stored on completion. */
export const CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE =
  'Ich bestätige, dass die oben dokumentierten Angaben zum Fahrzeugzustand und zu den übergebenen Gegenständen gemeinsam aufgenommen wurden. Dies ist keine Freigabe von Reparaturen oder eines Kostenvoranschlags.';

/** Canonical English text stored on completion. */
export const CHECK_IN_ACKNOWLEDGEMENT_TEXT_EN =
  'I confirm the vehicle condition and handed-over items documented above were recorded together. This is not approval of repairs or a cost estimate.';

export function resolveCheckInAcknowledgementText(
  locale: CheckInAcknowledgementLocale,
): string {
  return locale === 'en'
    ? CHECK_IN_ACKNOWLEDGEMENT_TEXT_EN
    : CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE;
}
