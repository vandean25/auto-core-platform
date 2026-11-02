import { BACK_OFFICE, BACK_OFFICE_DEMO, op } from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const PROCUREMENT_OPERATIONS: OperationTable = {
  'PurchaseController.createPurchaseOrder': op(
    'purchase.order.create',
    BACK_OFFICE,
    'site',
  ),
  'PurchaseController.receiveItems': op(
    'purchase.order.receive',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.markAsSent': op(
    'purchase.order.send',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.findAll': op(
    'purchase.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseController.findOne': op(
    'purchase.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseController.update': op(
    'purchase.order.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.remove': op(
    'purchase.order.delete',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.getPurchaseOrderItems': op(
    'purchase.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseController.getPurchaseOrderItem': op(
    'purchase.order.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseController.addItems': op(
    'purchase.order.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.updateItem': op(
    'purchase.order.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseController.deleteItem': op(
    'purchase.order.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseInvoiceController.create': op(
    'purchase.invoice.create',
    BACK_OFFICE,
    'site',
  ),
  'PurchaseInvoiceController.findAll': op(
    'purchase.invoice.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseInvoiceController.findOne': op(
    'purchase.invoice.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PurchaseInvoiceController.update': op(
    'purchase.invoice.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseInvoiceController.post': op(
    'purchase.invoice.post',
    BACK_OFFICE,
    'site',
    ['fiscal_lock', 'business_state'],
  ),
  'PurchaseInvoiceController.pay': op(
    'purchase.invoice.pay',
    BACK_OFFICE,
    'site',
    ['fiscal_lock', 'business_state'],
  ),
  'PurchaseInvoiceController.remove': op(
    'purchase.invoice.delete',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'PurchaseInvoiceController.removeLine': op(
    'purchase.invoice.update',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'VendorController.create': op('vendor.create', BACK_OFFICE, 'tenant'),
  'VendorController.findAll': op('vendor.read', BACK_OFFICE_DEMO, 'tenant'),
  'VendorController.findOne': op('vendor.read', BACK_OFFICE_DEMO, 'tenant'),
  'VendorController.update': op('vendor.update', BACK_OFFICE, 'tenant'),
  'VendorController.getArticles': op('vendor.read', BACK_OFFICE_DEMO, 'tenant'),
  'VendorController.remove': op('vendor.delete', BACK_OFFICE, 'tenant', [
    'business_state',
  ]),
  'VendorUnbilledController.getUnbilledReceipts': op(
    'vendor.unbilled_receipts.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'BrandController.create': op('brand.create', BACK_OFFICE, 'tenant'),
  'BrandController.findAll': op('brand.read', BACK_OFFICE_DEMO, 'tenant'),
  'BrandController.findOne': op('brand.read', BACK_OFFICE_DEMO, 'tenant'),
  'BrandController.update': op('brand.update', BACK_OFFICE, 'tenant'),
  'BrandController.remove': op('brand.delete', BACK_OFFICE, 'tenant', [
    'business_state',
  ]),
};
