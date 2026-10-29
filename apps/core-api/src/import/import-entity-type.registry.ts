import { ImportEntityType } from '@prisma/client';
import type { RequestContextService } from '../common/services/request-context.service.js';
import type { DecisionLiveApplyService } from '../decision/decision-live-apply.service.js';
import type { DecisionUseCaseHooksService } from '../decision/decision-use-case-hooks.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { CustomerImportHandler } from './customer-import.handler.js';
import type { ImportApplySequenceOrderKey } from './import-apply-sequence-order.js';
import type { ImportAuditWriter } from './import-audit.writer.js';
import type { RowByRowApplyRunner } from './import-row-apply.runner.js';
import type { ImportTypeHandler } from './import-type-handler.js';
import { ImportVendorResolver } from './import-vendor.resolver.js';
import {
  CUSTOMER_TEMPLATE,
  LABOR_OPERATION_TEMPLATE,
  SUPPLIER_PRICE_LIST_TEMPLATE,
  VEHICLE_DUE_DATE_TEMPLATE,
  VEHICLE_PARTY_TEMPLATE,
  VEHICLE_TEMPLATE,
} from './import.templates.js';
import type { ImportTemplateDefinition } from './import.types.js';
import { LaborOperationImportHandler } from './labor-operation-import.handler.js';
import type { SupplierChunkedApplyRunner } from './supplier-price-list-apply.runner.js';
import { SupplierPriceListImportHandler } from './supplier-price-list-import.handler.js';
import { VehicleDueDateImportHandler } from './vehicle-due-date-import.handler.js';
import { VehicleImportHandler } from './vehicle-import.handler.js';
import { VehiclePartyImportHandler } from './vehicle-party-import.handler.js';

export type ImportHandlerDeps = {
  prisma: PrismaService;
  audit: ImportAuditWriter;
  rowRunner: RowByRowApplyRunner;
  supplierRunner: SupplierChunkedApplyRunner;
  decisionHooks: DecisionUseCaseHooksService;
  decisionLive: DecisionLiveApplyService;
  requestContext: RequestContextService;
};

type ImportEntityTypeRegistration = {
  template: ImportTemplateDefinition;
  /** Order of the set-based apply_seq fill; must match the handler's synchronous apply order. */
  applyOrder: ImportApplySequenceOrderKey;
  /** Offered in the settings import wizard; otherwise API-only. */
  wizard: boolean;
  createHandler: (deps: ImportHandlerDeps) => ImportTypeHandler;
};

/** The only list of import entity types that have a CSV handler. */
export const IMPORT_ENTITY_TYPE_REGISTRY = {
  [ImportEntityType.CUSTOMER]: {
    template: CUSTOMER_TEMPLATE,
    applyOrder: 'row_no',
    wizard: true,
    createHandler: (deps) =>
      new CustomerImportHandler(
        deps.prisma,
        deps.audit,
        deps.rowRunner,
        deps.decisionHooks,
        deps.decisionLive,
        deps.requestContext,
      ),
  },
  [ImportEntityType.VEHICLE]: {
    template: VEHICLE_TEMPLATE,
    applyOrder: 'row_no',
    wizard: true,
    createHandler: (deps) =>
      new VehicleImportHandler(deps.prisma, deps.audit, deps.rowRunner),
  },
  [ImportEntityType.SUPPLIER_PRICE_LIST]: {
    template: SUPPLIER_PRICE_LIST_TEMPLATE,
    applyOrder: 'row_no',
    wizard: true,
    createHandler: (deps) =>
      new SupplierPriceListImportHandler(
        deps.prisma,
        new ImportVendorResolver(deps.prisma),
        deps.supplierRunner,
      ),
  },
  [ImportEntityType.LABOR_OPERATION]: {
    template: LABOR_OPERATION_TEMPLATE,
    applyOrder: 'row_no',
    wizard: true,
    createHandler: (deps) =>
      new LaborOperationImportHandler(deps.prisma, deps.audit, deps.rowRunner),
  },
  [ImportEntityType.VEHICLE_PARTY]: {
    template: VEHICLE_PARTY_TEMPLATE,
    applyOrder: 'updates_first',
    wizard: false,
    createHandler: (deps) =>
      new VehiclePartyImportHandler(deps.prisma, deps.audit, deps.rowRunner),
  },
  [ImportEntityType.VEHICLE_DUE_DATE]: {
    template: VEHICLE_DUE_DATE_TEMPLATE,
    applyOrder: 'row_no',
    wizard: false,
    createHandler: (deps) =>
      new VehicleDueDateImportHandler(deps.prisma, deps.audit, deps.rowRunner),
  },
} satisfies Partial<Record<ImportEntityType, ImportEntityTypeRegistration>>;

export type ImplementedImportEntityType =
  keyof typeof IMPORT_ENTITY_TYPE_REGISTRY;

export const IMPLEMENTED_IMPORT_ENTITY_TYPES = Object.keys(
  IMPORT_ENTITY_TYPE_REGISTRY,
) as ImplementedImportEntityType[];

export type ImportEntityTypeSummary = {
  entity_type: ImplementedImportEntityType;
  wizard: boolean;
  required_fields: string[];
};

export function createImportHandlers(
  deps: ImportHandlerDeps,
): Record<ImplementedImportEntityType, ImportTypeHandler> {
  const handlers = {} as Record<ImplementedImportEntityType, ImportTypeHandler>;
  for (const entityType of IMPLEMENTED_IMPORT_ENTITY_TYPES) {
    handlers[entityType] =
      IMPORT_ENTITY_TYPE_REGISTRY[entityType].createHandler(deps);
  }
  return handlers;
}

export function getImportTemplate(
  entityType: ImplementedImportEntityType,
): ImportTemplateDefinition {
  return IMPORT_ENTITY_TYPE_REGISTRY[entityType].template;
}

export function listImportEntityTypes(): ImportEntityTypeSummary[] {
  return IMPLEMENTED_IMPORT_ENTITY_TYPES.map((entityType) => {
    const { template, wizard } = IMPORT_ENTITY_TYPE_REGISTRY[entityType];
    return {
      entity_type: entityType,
      wizard,
      required_fields: template.fields
        .filter((field) => field.required)
        .map((field) => field.key),
    };
  });
}
