import {
  ADMINS,
  BACK_OFFICE,
  BACK_OFFICE_DEMO,
  op,
} from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const INVENTORY_OPERATIONS: OperationTable = {
  'LocationController.getTree': op(
    'stock.location.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.getBins': op(
    'stock.location.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.getChildren': op(
    'stock.location.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.findAll': op(
    'stock.location.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.create': op(
    'stock.location.manage',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.update': op(
    'stock.location.manage',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'LocationController.remove': op(
    'stock.location.manage',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'InventoryController.checkAvailability': op(
    'stock.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'InventoryController.getHistory': op(
    'stock.history.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'InventoryController.findOne': op('stock.read', BACK_OFFICE_DEMO, 'site'),
  'InventoryController.receiveStock': op('stock.receive', ADMINS, 'site', [
    'fiscal_lock',
  ]),
  'InventoryController.adjustStock': op('stock.adjust', ADMINS, 'site', [
    'fiscal_lock',
  ]),
  'InventoryController.updateItem': op('stock.item.update', ADMINS, 'site'),
  'InventoryController.findAll': op('stock.read', BACK_OFFICE_DEMO, 'site'),
  'InventoryController.createItem': op(
    'stock.item.create',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PartsRequisitionController.createReservation': op(
    'parts.reservation.create',
    BACK_OFFICE_DEMO,
    'site',
    ['business_state'],
  ),
  'PartsRequisitionController.consumeReservation': op(
    'parts.reservation.consume',
    BACK_OFFICE_DEMO,
    'site',
    ['business_state'],
  ),
  'PartsRequisitionController.releaseReservation': op(
    'parts.reservation.release',
    BACK_OFFICE_DEMO,
    'site',
    ['business_state'],
  ),
  'PartsRequisitionController.getShortages': op(
    'parts.requisition.read',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PartsRequisitionController.createRequisitionSheet': op(
    'parts.requisition.create',
    BACK_OFFICE_DEMO,
    'site',
  ),
  'PartsRequisitionController.createPurchaseOrder': op(
    'parts.requisition.purchase',
    BACK_OFFICE,
    'site',
    ['business_state'],
  ),
  'CatalogController.search': op('catalog.read', BACK_OFFICE_DEMO, 'tenant'),
  'CatalogController.externalSearch': op(
    'catalog.external.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'CatalogController.externalAssemblyGroups': op(
    'catalog.external.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'LaborController.search': op('labor.read', BACK_OFFICE_DEMO, 'tenant'),
  'LaborController.listOperations': op(
    'labor.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'LaborController.getOperation': op('labor.read', BACK_OFFICE_DEMO, 'tenant'),
  'LaborController.createOperation': op(
    'labor.operation.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'LaborController.updateOperation': op(
    'labor.operation.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'LaborController.removeOperation': op(
    'labor.operation.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'LaborController.getCategories': op('labor.read', BACK_OFFICE_DEMO, 'tenant'),
  'LaborController.createCategory': op(
    'labor.category.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'LaborController.updateCategory': op(
    'labor.category.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'LaborController.removeCategory': op(
    'labor.category.manage',
    BACK_OFFICE,
    'tenant',
  ),
  'StockTransferController.list': op(
    'stock.transfer.read',
    BACK_OFFICE_DEMO,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.detail': op(
    'stock.transfer.read',
    BACK_OFFICE_DEMO,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.create': op(
    'stock.transfer.create',
    BACK_OFFICE,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.approve': op(
    'stock.transfer.approve',
    ADMINS,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.reject': op(
    'stock.transfer.reject',
    ADMINS,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.cancel': op(
    'stock.transfer.cancel',
    BACK_OFFICE,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.ship': op(
    'stock.transfer.ship',
    BACK_OFFICE,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.receive': op(
    'stock.transfer.receive',
    BACK_OFFICE,
    'site',
    ['site_membership'],
  ),
  'StockTransferController.returnTransfer': op(
    'stock.transfer.return',
    BACK_OFFICE,
    'site',
    ['site_membership'],
  ),
  'BayController.findAll': op('bay.read', BACK_OFFICE_DEMO, 'site'),
  'BayController.findOne': op('bay.read', BACK_OFFICE_DEMO, 'site'),
  'BayController.create': op('bay.create', BACK_OFFICE_DEMO, 'site'),
  'BayController.update': op('bay.update', BACK_OFFICE_DEMO, 'site'),
  'BayController.remove': op('bay.delete', BACK_OFFICE, 'site', [
    'business_state',
  ]),
};
