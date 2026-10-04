import { MODULE_METADATA } from '@nestjs/common/constants';
import { DRY_RUN_REFUSED_KEY, DRY_RUN_SUPPORTED_KEY } from './dry-run.constants.js';
import { DryRunModule } from './dry-run.module.js';
import { AppModule } from '../app.module.js';
import { CustomerController } from '../customer/customer.controller.js';
import { VehicleController } from '../vehicle/vehicle.controller.js';
import { WorkshopController } from '../workshop/workshop.controller.js';
import { SalesController } from '../sales/sales.controller.js';
import { InvoicesController } from '../invoices/invoices.controller.js';
import { CreditNotesController } from '../credit-notes/credit-notes.controller.js';
import { AccountingExportController } from '../finance/accounting-export/accounting-export.controller.js';

describe('Dry-Run Endpoint Wiring', () => {
  describe('AppModule registration', () => {
    it('registers DryRunModule in AppModule imports', () => {
      const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, AppModule);
      expect(imports).toContain(DryRunModule);
    });
  });

  describe('Supported endpoints (@DryRunSupported)', () => {
    it('decorates POST /api/customers (CustomerController.create)', () => {
      const isSupported = Reflect.getMetadata(
        DRY_RUN_SUPPORTED_KEY,
        CustomerController.prototype.create,
      );
      expect(isSupported).toBe(true);
    });

    it('decorates POST /api/vehicles (VehicleController.create)', () => {
      const isSupported = Reflect.getMetadata(
        DRY_RUN_SUPPORTED_KEY,
        VehicleController.prototype.create,
      );
      expect(isSupported).toBe(true);
    });

    it('decorates POST /api/workshop/orders (WorkshopController.create)', () => {
      const isSupported = Reflect.getMetadata(
        DRY_RUN_SUPPORTED_KEY,
        WorkshopController.prototype.create,
      );
      expect(isSupported).toBe(true);
    });

    it('decorates PATCH /api/workshop/orders/:orderId/tasks/:taskId/line-items (WorkshopController.replaceTaskLineItems)', () => {
      const isSupported = Reflect.getMetadata(
        DRY_RUN_SUPPORTED_KEY,
        WorkshopController.prototype.replaceTaskLineItems,
      );
      expect(isSupported).toBe(true);
    });
  });

  describe('Refused endpoints (@DryRunRefused)', () => {
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
});
