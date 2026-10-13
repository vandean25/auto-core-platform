import { Prisma } from '@prisma/client';
import type {
  AccountingExportAllocationRules,
  AccountingExportRuleIssue,
} from './accounting-export-allocation-rules.js';
import type { AccountingExportBookingRow } from './accounting-export.types.js';

/**
 * Margin-scheme (Differenzbesteuerung) export, built best-effort under AUT-369
 * while accountant review is pending (ADR-0023 deferral log). A margin document
 * books its net sale to the mapped revenue account and its frozen margin VAT to
 * the entity's margin VAT account. The gross sale never receives an ordinary VAT
 * key, so it cannot be booked as ordinary VAT revenue.
 */

export type MarginSchemeAvailability =
  'AVAILABLE' | 'NOT_ENABLED' | 'VAT_ACCOUNT_MISSING';

export function marginSchemeAvailability(
  rules: AccountingExportAllocationRules,
): MarginSchemeAvailability {
  if (!rules.marginScheme.enabled) {
    return 'NOT_ENABLED';
  }
  if (!rules.marginScheme.vatAccount) {
    return 'VAT_ACCOUNT_MISSING';
  }
  return 'AVAILABLE';
}

const MARGIN_TAX_PATTERN = /^\d+\.\d{2}$/;

function readMarginTax(margin: unknown): string | null {
  if (!margin || typeof margin !== 'object') {
    return null;
  }
  const marginTax = (margin as { margin_tax?: unknown }).margin_tax;
  return typeof marginTax === 'string' && MARGIN_TAX_PATTERN.test(marginTax)
    ? marginTax
    : null;
}

/**
 * Document-level issue for a margin-scheme document, or null when it can be
 * booked. Only single-line documents qualify because the margin VAT is frozen per
 * document. `notSupportedMessage` keeps the invoice or credit wording of the
 * blanket block.
 */
export function marginDocumentIssue(input: {
  availability: MarginSchemeAvailability;
  notSupportedMessage: string;
  margin: unknown;
  lineGrosses: string[];
}): AccountingExportRuleIssue | null {
  if (input.availability === 'NOT_ENABLED') {
    return {
      code: 'UNSUPPORTED_EXPORT_TAX_MODE',
      message: input.notSupportedMessage,
    };
  }
  if (input.availability === 'VAT_ACCOUNT_MISSING') {
    return {
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message:
        'The margin VAT account is not configured for this export profile.',
    };
  }
  if (input.lineGrosses.length !== 1) {
    return {
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message: 'Margin-scheme export supports one vehicle line per document.',
    };
  }
  const marginTax = readMarginTax(input.margin);
  if (marginTax === null) {
    return {
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message:
        'Margin-scheme VAT facts are missing from the document snapshot.',
    };
  }
  if (new Prisma.Decimal(marginTax).greaterThan(input.lineGrosses[0])) {
    return {
      code: 'ACCOUNTING_MAPPING_INCOMPLETE',
      message:
        'Margin-scheme VAT facts are inconsistent with the document total.',
    };
  }
  return null;
}

type MarginRowBase = Pick<
  AccountingExportBookingRow,
  | 'documentId'
  | 'documentKind'
  | 'documentNumber'
  | 'documentDate'
  | 'lineId'
  | 'bookingText'
  | 'originalInvoiceNumber'
>;

/**
 * Two booking rows for one margin line: the net sale on the revenue account and
 * the frozen margin VAT on the margin VAT account. Both rows carry no BU key, so
 * no automatic tax is applied to the gross sale.
 */
export function buildMarginBookingRows(input: {
  base: MarginRowBase;
  polarity: 'S' | 'H';
  gross: string;
  margin: unknown;
  revenueAccount: string;
  debtorAccount: string;
  vatAccount: string | null;
}): AccountingExportBookingRow[] {
  const marginTax = readMarginTax(input.margin);
  if (marginTax === null || input.vatAccount === null) {
    return [];
  }

  const net = new Prisma.Decimal(input.gross).minus(marginTax).toFixed(2);
  const rowFor = (
    fields: Pick<
      AccountingExportBookingRow,
      'net' | 'tax' | 'gross' | 'revenueAccount'
    >,
  ): AccountingExportBookingRow => ({
    ...input.base,
    polarity: input.polarity,
    debtorAccount: input.debtorAccount,
    taxRate: '0.00',
    buKey: null,
    ...fields,
  });

  const rows: AccountingExportBookingRow[] = [];
  if (net !== '0.00') {
    rows.push(
      rowFor({
        net,
        tax: '0.00',
        gross: net,
        revenueAccount: input.revenueAccount,
      }),
    );
  }
  if (marginTax !== '0.00') {
    rows.push(
      rowFor({
        net: '0.00',
        tax: marginTax,
        gross: marginTax,
        revenueAccount: input.vatAccount,
      }),
    );
  }
  return rows;
}
