import { DRY_RUN_REFUSED_KEY } from './dry-run.constants.js';
import { SalesController } from '../sales/sales.controller.js';
import { InvoicesController } from '../invoices/invoices.controller.js';
import { CreditNotesController } from '../credit-notes/credit-notes.controller.js';
import { AccountingExportController } from '../finance/accounting-export/accounting-export.controller.js';

describe('Dry-run refused endpoint wiring', () => {
  const invoiceRefusalReason =
    'Invoice finalization consumes numbering sequences and creates irreversible legal tax records';
  const creditNoteRefusalReason =
    'Credit note finalization consumes numbering sequences and creates irreversible legal tax records';
  const accountingExportRefusalReason =
    'Accounting exports produce immutable exported financial bundles';

  it('refuses PUT /api/sales/invoices/:id/finalize (SalesController.finalize)', () => {
    const refusal = Reflect.getMetadata(
      DRY_RUN_REFUSED_KEY,
      SalesController.prototype.finalize,
    );
    expect(refusal).toEqual({
      refused: true,
      reason: invoiceRefusalReason,
    });
  });

  it('refuses PATCH /api/invoices/:id/issue (InvoicesController.issue)', () => {
    const refusal = Reflect.getMetadata(
      DRY_RUN_REFUSED_KEY,
      InvoicesController.prototype.issue,
    );
    expect(refusal).toEqual({
      refused: true,
      reason: invoiceRefusalReason,
    });
  });

  it('refuses POST /api/credit-notes/:id/finalize (CreditNotesController.finalize)', () => {
    const refusal = Reflect.getMetadata(
      DRY_RUN_REFUSED_KEY,
      CreditNotesController.prototype.finalize,
    );
    expect(refusal).toEqual({
      refused: true,
      reason: creditNoteRefusalReason,
    });
  });

  it('refuses POST /api/finance/accounting-exports (AccountingExportController.generate)', () => {
    const refusal = Reflect.getMetadata(
      DRY_RUN_REFUSED_KEY,
      AccountingExportController.prototype.generate,
    );
    expect(refusal).toEqual({
      refused: true,
      reason: accountingExportRefusalReason,
    });
  });
});
