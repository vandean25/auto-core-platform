import { createHash } from 'node:crypto';

/**
 * Code-owned, versioned legal copy for the Kostenvoranschlag (ADR-0025 §1,
 * AUT-360 D5/D19). Tenants cannot edit or remove it. Every sent version stores
 * the version id, the hash and the paragraphs it used.
 *
 * DRAFT: no lawyer-approved wording exists in the repository yet (AUT-360 D19
 * is open). The paragraphs below are an engineering draft built only from the
 * requirements in the feature spec. Customer send stays behind
 * CUSTOMER_ESTIMATE_SEND_ENABLED until the lawyer approves; the next approved
 * wording must ship as a new version id.
 */
export const WORKSHOP_ESTIMATE_LEGAL_TEXT_VERSION = 'kv-legal-de-v1';

export const WORKSHOP_ESTIMATE_NON_BINDING_DECLARATION_DE =
  'Dieser Kostenvoranschlag ist unverbindlich. Er beruht auf der Einschätzung der Arbeiten und Teile zum Zeitpunkt der Erstellung und verpflichtet Sie nicht zur Beauftragung.';

export const WORKSHOP_ESTIMATE_FREE_OF_CHARGE_DE =
  'Die Erstellung dieses Kostenvoranschlags ist für Sie kostenlos.';

export const WORKSHOP_ESTIMATE_PRIVACY_NOTICE_DE =
  'Hinweise zur Verarbeitung Ihrer personenbezogenen Daten finden Sie in der Datenschutzerklärung unseres Betriebs.';

export type WorkshopEstimateLegalBlock = {
  text_version: string;
  text_sha256: string;
  paragraphs: string[];
};

/**
 * Legal block for one version. The free-of-charge sentence is included only
 * while the estimate is free (AUT-360: free by default). The validity sentence
 * is the date-specific paragraph, so it is built here and hashed with the rest.
 */
export function buildWorkshopEstimateLegalBlock(params: {
  freeOfCharge: boolean;
  validUntilLabel: string;
}): WorkshopEstimateLegalBlock {
  const paragraphs = [
    WORKSHOP_ESTIMATE_NON_BINDING_DECLARATION_DE,
    ...(params.freeOfCharge ? [WORKSHOP_ESTIMATE_FREE_OF_CHARGE_DE] : []),
    `Gültig bis ${params.validUntilLabel} Uhr.`,
    WORKSHOP_ESTIMATE_PRIVACY_NOTICE_DE,
  ];
  return {
    text_version: WORKSHOP_ESTIMATE_LEGAL_TEXT_VERSION,
    text_sha256: createHash('sha256')
      .update(
        JSON.stringify({
          version: WORKSHOP_ESTIMATE_LEGAL_TEXT_VERSION,
          paragraphs,
        }),
        'utf8',
      )
      .digest('hex'),
    paragraphs,
  };
}
