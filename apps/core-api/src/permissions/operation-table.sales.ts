import {
  ADMINS,
  BACK_OFFICE,
  BACK_OFFICE_DEMO,
  op,
} from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const SALES_OPERATIONS: OperationTable = {
  'SalesController.createDraft': op(
    'invoice.draft.create',
    BACK_OFFICE,
    'site',
  ),
  'SalesController.updateDraft': op('invoice.draft.edit', BACK_OFFICE, 'site', [
    'business_state',
  ]),
  'SalesController.finalize': op('invoice.issue', BACK_OFFICE, 'site', [
    'fiscal_lock',
    'business_state',
  ]),
  'SalesController.findAll': op('invoice.read', BACK_OFFICE_DEMO, 'site'),
  'SalesController.findOne': op('invoice.read', BACK_OFFICE_DEMO, 'site'),
  'InvoicesController.createDraft': op(
    'invoice.draft.create',
    BACK_OFFICE,
    'site',
  ),
  'InvoicesController.issue': op('invoice.issue', BACK_OFFICE, 'site', [
    'fiscal_lock',
    'business_state',
  ]),
  'InvoicesController.generatePdf': op(
    'invoice.pdf.generate',
    BACK_OFFICE,
    'site',
    ['document_site'],
  ),
  'InvoicesController.getPdf': op('invoice.read', BACK_OFFICE_DEMO, 'site', [
    'document_site',
  ]),
  'SalesOrderController.create': op('sales.order.create', BACK_OFFICE, 'site'),
  'SalesOrderController.findAll': op(
    'sales.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'SalesOrderController.findOne': op(
    'sales.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'SalesOrderController.update': op('sales.order.update', BACK_OFFICE, 'site', [
    'business_state',
  ]),
  'SalesOrderController.remove': op('sales.order.delete', BACK_OFFICE, 'site', [
    'business_state',
  ]),
  'SalesOrderController.createInvoice': op(
    'sales.order.invoice',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'CreditNotesController.list': op('credit_note.read', BACK_OFFICE, 'site', [
    'site_membership',
  ]),
  'CreditNotesController.getPdf': op('credit_note.read', BACK_OFFICE, 'site', [
    'document_site',
  ]),
  'CreditNotesController.findOne': op('credit_note.read', BACK_OFFICE, 'site', [
    'document_site',
  ]),
  'CreditNotesController.updateDraft': op('credit_note.edit', ADMINS, 'site', [
    'document_site',
    'business_state',
  ]),
  'CreditNotesController.finalize': op('credit_note.finalize', ADMINS, 'site', [
    'document_site',
    'fiscal_lock',
    'business_state',
  ]),
  'CreditNotesController.void': op('credit_note.void', ADMINS, 'site', [
    'document_site',
    'fiscal_lock',
    'business_state',
  ]),
  'CreditNotesController.generatePdf': op(
    'credit_note.pdf.generate',
    ADMINS,
    'site',
    ['document_site'],
  ),
  'InvoiceCreditNotesController.listForInvoice': op(
    'credit_note.read',
    BACK_OFFICE,
    'site',
    ['document_site'],
  ),
  'InvoiceCreditNotesController.createFromInvoice': op(
    'credit_note.create',
    ADMINS,
    'site',
    ['document_site', 'fiscal_lock', 'business_state'],
  ),
  'SettlementController.getSettlement': op(
    'invoice.settlement.read',
    ADMINS,
    'site',
    ['document_site'],
  ),
  'SettlementController.recordSettlement': op(
    'invoice.settlement.record',
    ADMINS,
    'site',
    ['document_site', 'fiscal_lock', 'business_state'],
  ),
  'SettlementController.reconcileSettlement': op(
    'invoice.settlement.reconcile',
    ADMINS,
    'site',
    ['document_site', 'fiscal_lock', 'business_state'],
  ),
  'FiscalReceiptsController.cancelFiscalReceipt': op(
    'fiscal_receipt.cancel',
    ADMINS,
    'site',
    ['document_site', 'fiscal_lock', 'business_state'],
  ),
  'FinanceController.getSettings': op(
    'finance.settings.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'FinanceController.updateSettings': op(
    'finance.settings.update',
    BACK_OFFICE,
    'tenant',
    ['fiscal_lock'],
  ),
  'FinanceController.getRevenueGroups': op(
    'finance.revenue_group.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'FinanceController.createRevenueGroup': op(
    'finance.revenue_group.create',
    BACK_OFFICE,
    'tenant',
  ),
  'FinanceController.getRevenueAnalytics': op(
    'finance.revenue_analytics.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'AccountingExportReadinessController.readiness': op(
    'accounting_export.read',
    ADMINS,
    'tenant',
  ),
  'AccountingExportController.preview': op(
    'accounting_export.preview',
    ADMINS,
    'tenant',
    ['fiscal_lock'],
  ),
  'AccountingExportController.generate': op(
    'accounting_export.create',
    ADMINS,
    'tenant',
    ['fiscal_lock'],
  ),
  'AccountingExportController.list': op(
    'accounting_export.read',
    ADMINS,
    'tenant',
  ),
  'AccountingExportController.findOne': op(
    'accounting_export.read',
    ADMINS,
    'tenant',
  ),
  'AccountingExportController.download': op(
    'accounting_export.download',
    ADMINS,
    'tenant',
  ),
  'MarginRuleController.findAll': op(
    'margin_rule.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'MarginRuleController.getThreshold': op(
    'margin_rule.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'MarginRuleController.updateThreshold': op(
    'margin_rule.threshold.update',
    ADMINS,
    'tenant',
  ),
  'MarginRuleController.create': op('margin_rule.create', ADMINS, 'tenant'),
  'MarginRuleController.update': op('margin_rule.update', ADMINS, 'tenant'),
  'MarginRuleController.patch': op('margin_rule.update', ADMINS, 'tenant'),
  'MarginRuleController.delete': op('margin_rule.delete', ADMINS, 'tenant'),
  'CustomerController.create': op(
    'customer.create',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'CustomerController.findAll': op('customer.read', BACK_OFFICE_DEMO, 'tenant'),
  'CustomerController.findOne': op('customer.read', BACK_OFFICE_DEMO, 'tenant'),
  'CustomerController.update': op(
    'customer.update',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'CustomerController.remove': op('customer.delete', BACK_OFFICE, 'tenant', [
    'business_state',
  ]),
  'CustomerConsentController.getPreferences': op(
    'customer.consent.read',
    BACK_OFFICE,
    'tenant',
  ),
  'CustomerConsentController.getHistory': op(
    'customer.consent.read',
    BACK_OFFICE,
    'tenant',
  ),
  'CustomerConsentController.recordEvent': op(
    'customer.consent.record',
    BACK_OFFICE,
    'tenant',
  ),
};
