/**
 * Frozen check-in signature acknowledgement copy (simple e-signature for evidence only, not QES).
 * TODO(legal-review): replace with counsel-approved DE/EN wording before production customer use.
 */
export const CHECK_IN_ACKNOWLEDGEMENT_VERSION = 'check-in-signature-v1';

/** Canonical German text stored on completion; UI must show the matching i18n string. */
export const CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE =
  'Ich bestätige, dass die oben dokumentierten Angaben zum Fahrzeugzustand und zu den übergebenen Gegenständen gemeinsam aufgenommen wurden. Diese Bestätigung ist keine Freigabe von Reparaturen oder eines Kostenvoranschlags.';

export function resolveCheckInAcknowledgementText(
  locale: string | undefined,
): string {
  const normalized = locale?.trim().toLowerCase() ?? '';
  if (normalized.startsWith('en')) {
    return CHECK_IN_ACKNOWLEDGEMENT_TEXT_EN;
  }
  return CHECK_IN_ACKNOWLEDGEMENT_TEXT_DE;
}

/** English mirror for stored evidence when the advisor completes in EN. */
export const CHECK_IN_ACKNOWLEDGEMENT_TEXT_EN =
  'I confirm that the vehicle condition and handed-over items documented above were recorded together. This confirmation is not approval of repairs or a cost estimate.';
