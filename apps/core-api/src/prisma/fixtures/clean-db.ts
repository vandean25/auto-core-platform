import { enableLegacyMigrationPurgeFlag } from './legacy-migration-purge-flag.js';
import type { SeedPrismaClient } from './types.js';
import {
  DEMO_GEWAHRLEISTUNG_PURCHASE_NUMBERS,
  DEMO_GEWAHRLEISTUNG_CUSTOMER_EMAILS,
  DEMO_GEWAHRLEISTUNG_SALE_NUMBERS,
  DEMO_GEWAHRLEISTUNG_VINS,
} from './gewaehrleistung-demo.constants.js';

export interface TableCleaner {
  table: string;
  clean: (prisma: SeedPrismaClient) => Promise<unknown>;
}

/**
 * Ordered list of table cleaners arranged in topological order to satisfy foreign key constraints.
 * Dependent / child tables are cleaned before referenced / parent tables.
 * `tenants` is cleaned last because all tenant-scoped tables reference it via foreign key.
 * Every table that references `tenants`, directly or through another table, needs a cleaner here.
 * clean-db.spec.ts checks this against prisma/schema.prisma.
 */
export const TABLE_CLEANERS: TableCleaner[] = [
  {
    table: 'inventory_transactions',
    clean: (p) => p.inventoryTransaction.deleteMany(),
  },
  {
    table: 'parts_reservations',
    clean: (p) => p.partsReservation.deleteMany(),
  },
  {
    table: 'parts_requisition_lines',
    clean: (p) => p.partsRequisitionLine.deleteMany(),
  },
  {
    table: 'parts_requisitions',
    clean: (p) => p.partsRequisition.deleteMany(),
  },
  {
    table: 'purchase_invoice_lines',
    clean: (p) => p.purchaseInvoiceLine.deleteMany(),
  },
  { table: 'purchase_invoices', clean: (p) => p.purchaseInvoice.deleteMany() },
  {
    table: 'purchase_order_items',
    clean: (p) => p.purchaseOrderItem.deleteMany(),
  },
  { table: 'purchase_orders', clean: (p) => p.purchaseOrder.deleteMany() },
  { table: 'inventory_stocks', clean: (p) => p.inventoryStock.deleteMany() },
  { table: 'credit_note_items', clean: (p) => p.creditNoteItem.deleteMany() },
  { table: 'invoice_items', clean: (p) => p.invoiceItem.deleteMany() },
  { table: 'credit_notes', clean: (p) => p.creditNote.deleteMany() },
  {
    table: 'invoice_brand_asset_references',
    clean: (p) => p.invoiceBrandAssetReference.deleteMany(),
  },
  { table: 'sales_order_items', clean: (p) => p.salesOrderItem.deleteMany() },
  {
    table: 'stock_transfer_lines',
    clean: (p) => p.stockTransferLine.deleteMany(),
  },
  {
    table: 'domain_event_consumer_deliveries',
    clean: (p) => p.domainEventConsumerDelivery.deleteMany(),
  },
  {
    table: 'inspection_measurements',
    clean: (p) => p.inspectionMeasurement.deleteMany(),
  },
  {
    table: 'inspection_measurement_imports',
    clean: (p) => p.inspectionMeasurementImport.deleteMany(),
  },
  {
    table: 'inspection_measurement_identities',
    clean: (p) => p.inspectionMeasurementIdentity.deleteMany(),
  },
  {
    table: 'vehicle_valuation_snapshots',
    clean: (p) => p.vehicleValuationSnapshot.deleteMany(),
  },
  {
    table: 'customer_communication_states',
    clean: (p) => p.customerCommunicationState.deleteMany(),
  },
  {
    table: 'customer_consent_unsubscribe_tokens',
    clean: (p) => p.customerConsentUnsubscribeToken.deleteMany(),
  },
  { table: 'customer_consents', clean: (p) => p.customerConsent.deleteMany() },
  {
    table: 'customer_contact_points',
    clean: (p) => p.customerContactPoint.deleteMany(),
  },
  { table: 'loaner_bookings', clean: (p) => p.loanerBooking.deleteMany() },
  { table: 'loaner_vehicles', clean: (p) => p.loanerVehicle.deleteMany() },
  { table: 'agent_action_logs', clean: (p) => p.agentActionLog.deleteMany() },
  // Platform rules (tenant_id NULL) come from migrations; the seed does not recreate them.
  {
    table: 'agent_policy_rules',
    clean: (p) =>
      p.agentPolicyRule.deleteMany({ where: { tenant_id: { not: null } } }),
  },
  { table: 'agent_proposals', clean: (p) => p.agentProposal.deleteMany() },
  { table: 'attendance_events', clean: (p) => p.attendanceEvent.deleteMany() },
  { table: 'audit_logs', clean: (p) => p.auditLog.deleteMany() },
  {
    table: 'credit_note_sequences',
    clean: (p) => p.creditNoteSequence.deleteMany(),
  },
  {
    table: 'decision_shadow_logs',
    clean: (p) => p.decisionShadowLog.deleteMany(),
  },
  {
    table: 'document_brand_profiles',
    clean: (p) => p.documentBrandProfile.deleteMany(),
  },
  {
    table: 'document_brand_extractions',
    clean: (p) => p.documentBrandExtraction.deleteMany(),
  },
  {
    table: 'document_brand_quota_events',
    clean: (p) => p.documentBrandQuotaEvent.deleteMany(),
  },
  {
    table: 'document_brand_quota_locks',
    clean: (p) => p.documentBrandQuotaLock.deleteMany(),
  },
  {
    table: 'domain_event_consumer_progress',
    clean: (p) => p.domainEventConsumerProgress.deleteMany(),
  },
  {
    table: 'employee_leave_balances',
    clean: (p) => p.employeeLeaveBalance.deleteMany(),
  },
  {
    table: 'employee_work_schedule_days',
    clean: (p) => p.employeeWorkScheduleDay.deleteMany(),
  },
  {
    table: 'employee_work_schedules',
    clean: (p) => p.employeeWorkSchedule.deleteMany(),
  },
  {
    table: 'external_id_mappings',
    clean: (p) => p.externalIdMapping.deleteMany(),
  },
  { table: 'fiscal_receipts', clean: (p) => p.fiscalReceipt.deleteMany() },
  { table: 'payments', clean: (p) => p.payment.deleteMany() },
  {
    table: 'invoices',
    clean: async (p) => {
      await p.invoice.deleteMany({
        where: {
          tenant: { is: { slug: 'default-workshop' } },
          vehicle_sale: {
            is: { sale_number: { in: [...DEMO_GEWAHRLEISTUNG_SALE_NUMBERS] } },
          },
        },
      });
      await p.invoice.deleteMany();
    },
  },
  { table: 'vendor_articles', clean: (p) => p.vendorArticle.deleteMany() },
  {
    table: 'catalog_price_histories',
    clean: (p) => p.catalogPriceHistory.deleteMany(),
  },
  { table: 'sales_orders', clean: (p) => p.salesOrder.deleteMany() },
  { table: 'fiscal_registers', clean: (p) => p.fiscalRegister.deleteMany() },
  {
    table: 'legacy_document_lines',
    clean: (p) => p.legacyDocumentLine.deleteMany(),
  },
  { table: 'legacy_documents', clean: (p) => p.legacyDocument.deleteMany() },
  { table: 'import_job_rows', clean: (p) => p.importJobRow.deleteMany() },
  { table: 'import_jobs', clean: (p) => p.importJob.deleteMany() },
  { table: 'migration_runs', clean: (p) => p.migrationRun.deleteMany() },
  {
    table: 'import_mapping_profiles',
    clean: (p) => p.importMappingProfile.deleteMany(),
  },
  {
    table: 'inspection_catalogue_entries',
    clean: (p) => p.inspectionCatalogueEntry.deleteMany(),
  },
  {
    table: 'inspection_catalogue_imports',
    clean: (p) => p.inspectionCatalogueImport.deleteMany(),
  },
  {
    table: 'inspection_device_evidence',
    clean: (p) => p.inspectionDeviceEvidence.deleteMany(),
  },
  {
    table: 'inspection_device_sources',
    clean: (p) => p.inspectionDeviceSource.deleteMany(),
  },
  {
    table: 'inspection_exchange_events',
    clean: (p) => p.inspectionExchangeEvent.deleteMany(),
  },
  {
    table: 'inspection_finding_references',
    clean: (p) => p.inspectionFindingReference.deleteMany(),
  },
  {
    table: 'inspection_support_events',
    clean: (p) => p.inspectionSupportEvent.deleteMany(),
  },
  {
    table: 'inspector_evidence_revisions',
    clean: (p) => p.inspectorEvidenceRevision.deleteMany(),
  },
  { table: 'invoice_sequences', clean: (p) => p.invoiceSequence.deleteMany() },
  { table: 'labor_entries', clean: (p) => p.laborEntry.deleteMany() },
  { table: 'leave_requests', clean: (p) => p.leaveRequest.deleteMany() },
  {
    table: 'mcp_write_command_receipts',
    clean: (p) => p.mcpWriteCommandReceipt.deleteMany(),
  },
  {
    table: 'registration_intake_byte_purges',
    clean: (p) => p.registrationIntakeBytePurge.deleteMany(),
  },
  {
    table: 'registration_document_intakes',
    clean: (p) => p.registrationDocumentIntake.deleteMany(),
  },
  {
    table: 'stock_transfer_commands',
    clean: (p) => p.stockTransferCommand.deleteMany(),
  },
  { table: 'stock_transfers', clean: (p) => p.stockTransfer.deleteMany() },
  { table: 'tenant_api_keys', clean: (p) => p.tenantApiKey.deleteMany() },
  {
    table: 'tenant_inspection_catalogue_activations',
    clean: (p) => p.tenantInspectionCatalogueActivation.deleteMany(),
  },
  {
    table: 'inspection_catalogue_versions',
    clean: (p) => p.inspectionCatalogueVersion.deleteMany(),
  },
  { table: 'tyre_set_events', clean: (p) => p.tyreSetEvent.deleteMany() },
  { table: 'tyre_sets', clean: (p) => p.tyreSet.deleteMany() },
  {
    table: 'tyre_storage_settings',
    clean: (p) => p.tyreStorageSettings.deleteMany(),
  },
  {
    table: 'voice_translation_settings',
    clean: (p) => p.voiceTranslationSettings.deleteMany(),
  },
  {
    table: 'warranty_claim_lines',
    clean: (p) => p.warrantyClaimLine.deleteMany(),
  },
  {
    table: 'workshop_task_line_items',
    clean: (p) => p.workshopTaskLineItem.deleteMany(),
  },
  { table: 'catalog_items', clean: (p) => p.catalogItem.deleteMany() },
  {
    table: 'workshop_opening_hours',
    clean: (p) => p.workshopOpeningHour.deleteMany(),
  },
  { table: 'workshop_holidays', clean: (p) => p.workshopHoliday.deleteMany() },
  { table: 'site_memberships', clean: (p) => p.siteMembership.deleteMany() },
  { table: 'domain_events', clean: (p) => p.domainEvent.deleteMany() },
  {
    table: 'accounting_exports',
    clean: (p) => p.accountingExport.deleteMany(),
  },
  {
    table: 'legal_entity_accounting_profiles',
    clean: (p) => p.legalEntityAccountingProfile.deleteMany(),
  },
  { table: 'margin_rules', clean: (p) => p.marginRule.deleteMany() },
  { table: 'revenue_groups', clean: (p) => p.revenueGroup.deleteMany() },
  { table: 'finance_settings', clean: (p) => p.financeSettings.deleteMany() },
  {
    table: 'catalog_provider_settings',
    clean: (p) => p.catalogProviderSettings.deleteMany(),
  },
  { table: 'labor_operations', clean: (p) => p.laborOperation.deleteMany() },
  {
    table: 'labor_categories',
    clean: async (p) => {
      await p.laborCategory.deleteMany({ where: { parent_id: { not: null } } });
      await p.laborCategory.deleteMany();
    },
  },
  {
    table: 'notification_outbox',
    clean: (p) => p.notificationOutbox.deleteMany(),
  },
  {
    table: 'voice_note_rate_limits',
    clean: (p) => p.voiceNoteRateLimit.deleteMany(),
  },
  {
    table: 'vehicle_inspection_records',
    clean: (p) => p.vehicleInspectionRecord.deleteMany(),
  },
  {
    table: 'vehicle_ledger_entries',
    clean: async (p) => {
      const vehicles = await p.vehicle.findMany({
        where: {
          tenant: { is: { slug: 'default-workshop' } },
          vin: { in: [...DEMO_GEWAHRLEISTUNG_VINS] },
        },
        select: { id: true },
      });
      await p.vehicleLedgerEntry.deleteMany({
        where: { vehicle_id: { in: vehicles.map(({ id }) => id) } },
      });
    },
  },
  {
    table: 'vehicle_sales',
    clean: (p) =>
      p.vehicleSale.deleteMany({
        where: {
          tenant: { is: { slug: 'default-workshop' } },
          sale_number: { in: [...DEMO_GEWAHRLEISTUNG_SALE_NUMBERS] },
        },
      }),
  },
  {
    table: 'vehicle_listing_channel_dms_syncs',
    clean: (p) => p.vehicleListingChannelDmsSync.deleteMany(),
  },
  {
    table: 'vehicle_listing_photos',
    clean: (p) => p.vehicleListingPhoto.deleteMany(),
  },
  {
    table: 'vehicle_listing_channels',
    clean: (p) => p.vehicleListingChannel.deleteMany(),
  },
  {
    table: 'vehicle_listing_push_settings',
    clean: (p) => p.vehicleListingPushSettings.deleteMany(),
  },
  {
    table: 'vehicle_listings',
    clean: (p) => p.vehicleListing.deleteMany(),
  },
  {
    table: 'vehicle_equipment_selections',
    clean: (p) => p.vehicleEquipmentSelection.deleteMany(),
  },
  {
    table: 'vehicle_equipment_free_text_items',
    clean: (p) => p.vehicleEquipmentFreeTextItem.deleteMany(),
  },
  {
    table: 'external_inspection_results',
    clean: (p) => p.externalInspectionResult.deleteMany(),
  },
  {
    table: 'inspection_exchange_imports',
    clean: (p) => p.inspectionExchangeImport.deleteMany(),
  },
  {
    table: 'inspection_report_identities',
    clean: (p) => p.inspectionReportIdentity.deleteMany(),
  },
  { table: 'vehicle_media', clean: (p) => p.vehicleMedia.deleteMany() },
  {
    table: 'vehicle_purchases',
    clean: (p) =>
      p.vehiclePurchase.deleteMany({
        where: {
          tenant: { is: { slug: 'default-workshop' } },
          purchase_number: { in: [...DEMO_GEWAHRLEISTUNG_PURCHASE_NUMBERS] },
        },
      }),
  },
  {
    table: 'inspection_source_connections',
    clean: (p) => p.inspectionSourceConnection.deleteMany(),
  },
  { table: 'tenant_members', clean: (p) => p.tenantMember.deleteMany() },
  { table: 'warranty_claims', clean: (p) => p.warrantyClaim.deleteMany() },
  {
    table: 'workshop_command_presets',
    clean: (p) => p.workshopCommandPreset.deleteMany(),
  },
  {
    table: 'workshop_estimate_approvals',
    clean: (p) => p.workshopEstimateApproval.deleteMany(),
  },
  {
    table: 'workshop_estimate_approval_tokens',
    clean: (p) => p.workshopEstimateApprovalToken.deleteMany(),
  },
  {
    table: 'workshop_estimate_brand_asset_references',
    clean: (p) => p.workshopEstimateBrandAssetReference.deleteMany(),
  },
  {
    table: 'document_brand_assets',
    clean: (p) => p.documentBrandAsset.deleteMany(),
  },
  {
    table: 'workshop_estimate_overruns',
    clean: (p) => p.workshopEstimateOverrun.deleteMany(),
  },
  {
    table: 'workshop_estimate_sequences',
    clean: (p) => p.workshopEstimateSequence.deleteMany(),
  },
  {
    table: 'workshop_estimate_versions',
    clean: (p) => p.workshopEstimateVersion.deleteMany(),
  },
  {
    table: 'workshop_estimates',
    clean: (p) => p.workshopEstimate.deleteMany(),
  },
  {
    table: 'workshop_inspection_items',
    clean: (p) => p.workshopInspectionItem.deleteMany(),
  },
  {
    table: 'inspection_template_items',
    clean: (p) => p.inspectionTemplateItem.deleteMany(),
  },
  { table: 'workshop_media', clean: (p) => p.workshopMedia.deleteMany() },
  { table: 'workshop_check_ins', clean: (p) => p.workshopCheckIn.deleteMany() },
  {
    table: 'workshop_inspections',
    clean: (p) => p.workshopInspection.deleteMany(),
  },
  {
    table: 'inspection_templates',
    clean: (p) => p.inspectionTemplate.deleteMany(),
  },
  {
    table: 'workshop_voice_note_drafts',
    clean: (p) => p.workshopVoiceNoteDraft.deleteMany(),
  },
  { table: 'workshop_tasks', clean: (p) => p.workshopTask.deleteMany() },
  { table: 'workshop_orders', clean: (p) => p.workshopOrder.deleteMany() },
  { table: 'vehicles', clean: (p) => p.vehicle.deleteMany() },
  {
    table: 'vehicle_equipment_options',
    clean: (p) => p.vehicleEquipmentOption.deleteMany(),
  },
  {
    table: 'catalog_oem_concern_makes',
    clean: (p) => p.catalogOemConcernMake.deleteMany(),
  },
  {
    table: 'catalog_oem_concerns',
    clean: (p) => p.catalogOemConcern.deleteMany(),
  },
  {
    table: 'vehicle_make_aliases',
    clean: (p) => p.vehicleMakeAlias.deleteMany(),
  },
  {
    table: 'customers',
    clean: async (p) => {
      await p.customer.deleteMany({
        where: {
          tenant: { is: { slug: 'default-workshop' } },
          email: { in: [...DEMO_GEWAHRLEISTUNG_CUSTOMER_EMAILS] },
        },
      });
      await p.customer.deleteMany();
    },
  },
  { table: 'vendors', clean: (p) => p.vendor.deleteMany() },
  { table: 'brands', clean: (p) => p.brand.deleteMany() },
  { table: 'bays', clean: (p) => p.bay.deleteMany() },
  { table: 'employees', clean: (p) => p.employee.deleteMany() },
  {
    table: 'labor_price_groups',
    clean: (p) => p.laborPriceGroup.deleteMany(),
  },
  { table: 'storage_locations', clean: (p) => p.storageLocation.deleteMany() },
  { table: 'sites', clean: (p) => p.site.deleteMany() },
  { table: 'legal_entities', clean: (p) => p.legalEntity.deleteMany() },
  { table: 'tenants', clean: (p) => p.tenant.deleteMany() },
];

async function getExistingTables(
  prisma: SeedPrismaClient,
): Promise<Set<string>> {
  // eslint-disable-next-line no-restricted-syntax -- Schema inspection to discover existing tables in database
  const result = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
  `;
  return new Set((result || []).map((row) => row.table_name));
}

/**
 * Cleans all database tables in topological order to satisfy foreign key constraints.
 * Replaces iterative single tableExists checks with a single query to information_schema.
 */
export async function cleanDb(prisma: SeedPrismaClient): Promise<string[]> {
  console.log('Cleaning database...');
  const existingTables = await getExistingTables(prisma);
  const cleaned: string[] = [];

  const runCleaners = async (client: SeedPrismaClient) => {
    for (const cleaner of TABLE_CLEANERS) {
      if (existingTables.has(cleaner.table)) {
        await cleaner.clean(client);
        cleaned.push(cleaner.table);
      }
    }
  };

  if (typeof prisma.$transaction === 'function') {
    await prisma.$transaction(async (tx) => {
      await enableLegacyMigrationPurgeFlag(tx);
      await runCleaners(tx as SeedPrismaClient);
    });
  } else {
    await runCleaners(prisma);
  }

  return cleaned;
}
