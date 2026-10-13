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
 * the entity's margin VAT account. The rows carry no BU key. That keeps the BU key
 * out of the file, but it does not stop DATEV from applying tax from an
 * automatic-tax account. The mapped revenue account must therefore not be an
 * automatic-tax account. ACP does not check the DATEV chart, so the accountant
 * verifies this assumption.
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

const MARGIN_ALLOCATION_NOT_EXPORTABLE =
  'Margin-scheme allocations cannot be exported with the active profile.';
const MARGIN_LINE_ALLOCATION_MISSING =
  'Margin-scheme document line has no margin accounting allocation.';
const MARGIN_MANUAL_BU_NOT_SUPPORTED =
  'Manual BU keys are not used for margin-scheme documents.';

/**
 * Document-level issue for a margin-scheme document, or null when it can be
 * booked or is not a margin document. Only single-line documents qualify because
 * the margin VAT is frozen per document. `notSupportedMessage` keeps the invoice
 * or credit wording of the blanket block.
 */
export function marginDocumentIssue(input: {
  isMarginDocument: boolean;
  availability: MarginSchemeAvailability;
  notSupportedMessage: string;
  margin: unknown;
  lineGrosses: string[];
}): AccountingExportRuleIssue | null {
  if (!input.isMarginDocument) {
    return null;
  }
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

/**
 * Line-level issue for one frozen allocation. A margin allocation is blocked
 * unless its document is a margin document on an enabled profile, and a margin
 * document line must carry a margin allocation. A margin allocation with a
 * manual BU key is blocked, because the margin rows carry no BU key.
 */
export function marginLineIssue(input: {
  isMarginDocument: boolean;
  availability: MarginSchemeAvailability;
  allocationTaxMode: string;
  allocationTaxTreatment: string;
}): AccountingExportRuleIssue | null {
  if (input.allocationTaxMode === 'MARGIN_SCHEME') {
    if (!input.isMarginDocument || input.availability === 'NOT_ENABLED') {
      return {
        code: 'UNSUPPORTED_EXPORT_TAX_MODE',
        message: MARGIN_ALLOCATION_NOT_EXPORTABLE,
      };
    }
    return input.allocationTaxTreatment === 'manual_bu'
      ? {
          code: 'ACCOUNTING_MAPPING_INCOMPLETE',
          message: MARGIN_MANUAL_BU_NOT_SUPPORTED,
        }
      : null;
  }
  return input.isMarginDocument && input.availability === 'AVAILABLE'
    ? {
        code: 'ACCOUNTING_MAPPING_INCOMPLETE',
        message: MARGIN_LINE_ALLOCATION_MISSING,
      }
    : null;
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
 * the frozen margin VAT on the margin VAT account. Neither row carries a BU key.
 * The revenue account must not be an automatic-tax account (see the module note
 * above).
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
    // The blockers reject these documents before any rows are built. Reaching
    // this point is a bug, and an empty result would export the document with
    // no amounts, so fail loudly instead.
    throw new Error(
      'Margin booking rows require validated margin facts and a margin VAT account.',
    );
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
