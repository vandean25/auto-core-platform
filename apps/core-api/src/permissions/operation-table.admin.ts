import {
  ADMINS,
  BACK_OFFICE,
  BACK_OFFICE_DEMO,
  EVERY_ROLE,
  op,
} from './operation-helpers.js';
import type { OperationTable } from './operation-types.js';

export const ADMIN_OPERATIONS: OperationTable = {
  'SiteController.listSites': op('site.read', BACK_OFFICE_DEMO, 'tenant'),
  'SiteController.getSite': op('site.read', BACK_OFFICE_DEMO, 'tenant', [
    'site_membership',
  ]),
  'SiteController.createSite': op('site.create', ADMINS, 'tenant'),
  'SiteController.updateSite': op('site.update', ADMINS, 'tenant'),
  'SiteController.deleteSite': op('site.delete', ADMINS, 'tenant', [
    'business_state',
  ]),
  'SiteController.listSiteMemberships': op(
    'site.membership.read',
    ADMINS,
    'tenant',
  ),
  'SiteController.addSiteMembership': op(
    'site.membership.manage',
    ADMINS,
    'tenant',
  ),
  'SiteController.removeSiteMembership': op(
    'site.membership.manage',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.listLegalEntities': op(
    'legal_entity.read',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.getAccountingProfile': op(
    'legal_entity.accounting_profile.read',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.updateAccountingProfile': op(
    'legal_entity.accounting_profile.update',
    ADMINS,
    'tenant',
    ['fiscal_lock'],
  ),
  'LegalEntityController.getLegalEntity': op(
    'legal_entity.read',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.createLegalEntity': op(
    'legal_entity.create',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.updateLegalEntity': op(
    'legal_entity.update',
    ADMINS,
    'tenant',
  ),
  'LegalEntityController.deleteLegalEntity': op(
    'legal_entity.delete',
    ADMINS,
    'tenant',
    ['business_state'],
  ),
  'DocumentBrandingController.getProfile': op(
    'document_branding.read',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.saveDraft': op(
    'document_branding.edit',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.setDraftSource': op(
    'document_branding.edit',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.removeDraftSource': op(
    'document_branding.edit',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.discardDraft': op(
    'document_branding.edit',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.confirm': op(
    'document_branding.confirm',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.reset': op(
    'document_branding.reset',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.preview': op(
    'document_branding.preview',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.uploadAsset': op(
    'document_branding.upload',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.createExtraction': op(
    'document_branding.extract',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.getExtraction': op(
    'document_branding.read',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.discardExtraction': op(
    'document_branding.edit',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.getAsset': op(
    'document_branding.read',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.getAssetContent': op(
    'document_branding.read',
    ADMINS,
    'tenant',
  ),
  'DocumentBrandingController.getAssetPagePreview': op(
    'document_branding.read',
    ADMINS,
    'tenant',
  ),
  'ImportController.createDryRun': op('import.create', ADMINS, 'tenant'),
  'ImportController.startDirectUpload': op(
    'import.upload.start',
    ADMINS,
    'tenant',
  ),
  'ImportController.finalizeDirectUpload': op(
    'import.upload.finalize',
    ADMINS,
    'tenant',
  ),
  'ImportController.listMappingProfiles': op(
    'import.mapping_profile.read',
    ADMINS,
    'tenant',
  ),
  'ImportController.createMappingProfile': op(
    'import.mapping_profile.create',
    ADMINS,
    'tenant',
  ),
  'ImportController.listSources': op('import.source.read', ADMINS, 'tenant'),
  'ImportController.createSource': op('import.source.create', ADMINS, 'tenant'),
  'ImportController.updateSource': op('import.source.update', ADMINS, 'tenant'),
  'ImportController.deleteSource': op(
    'import.source.delete',
    ADMINS,
    'tenant',
    ['business_state'],
  ),
  'ImportController.getTemplate': op(
    'import.template.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'ImportController.downloadTemplateCsv': op(
    'import.template.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'ImportController.listEntityTypes': op(
    'import.template.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'ImportController.listJobs': op('import.job.read', ADMINS, 'tenant'),
  'ImportController.listRows': op('import.job.read', ADMINS, 'tenant'),
  'ImportController.downloadErrors': op('import.job.read', ADMINS, 'tenant'),
  'ImportController.getJob': op('import.job.read', ADMINS, 'tenant'),
  'ImportController.previewUndo': op('import.undo.preview', ADMINS, 'tenant'),
  'ImportController.undoJob': op('import.undo', ADMINS, 'tenant', [
    'business_state',
  ]),
  'ImportController.apply': op('import.apply', ADMINS, 'tenant', [
    'business_state',
  ]),
  'ImportController.cancel': op('import.cancel', ADMINS, 'tenant', [
    'business_state',
  ]),
  'CanonicalMigrationImportController.validateCanonicalMigration': op(
    'import.canonical_migration.validate',
    ADMINS,
    'tenant',
  ),
  'TenantApiKeyController.list': op('api_key.read', ADMINS, 'tenant'),
  'TenantApiKeyController.create': op('api_key.create', ADMINS, 'tenant'),
  'TenantApiKeyController.revoke': op('api_key.revoke', ADMINS, 'tenant'),
  'TenantLocaleController.getCurrent': op(
    'tenant.locale.read',
    BACK_OFFICE_DEMO,
    'tenant',
  ),
  'TenantLocaleController.patchCurrent': op(
    'tenant.locale.update',
    ADMINS,
    'tenant',
  ),
  'CatalogProviderSettingsController.getSettings': op(
    'settings.catalog_provider.read',
    ADMINS,
    'tenant',
  ),
  'CatalogProviderSettingsController.updateSettings': op(
    'settings.catalog_provider.update',
    ADMINS,
    'tenant',
  ),
  'AgentPolicyController.listRules': op('agent.policy.read', ADMINS, 'tenant'),
  'AgentPolicyController.upsertRule': op(
    'agent.policy.update',
    ADMINS,
    'tenant',
  ),
  'AgentPolicyController.evaluate': op(
    'agent.policy.evaluate',
    ADMINS,
    'tenant',
  ),
  'AgentProposalController.listProposals': op(
    'agent.proposal.read',
    ADMINS,
    'tenant',
  ),
  'AgentProposalController.approveProposal': op(
    'agent.proposal.approve',
    ADMINS,
    'tenant',
    ['agent_policy'],
  ),
  'AgentProposalController.applyProposal': op(
    'agent.proposal.apply',
    ADMINS,
    'tenant',
    ['agent_policy'],
  ),
  'AgentProposalController.batchApplyProposals': op(
    'agent.proposal.apply',
    ADMINS,
    'tenant',
    ['agent_policy'],
  ),
  'AgentProposalController.rejectProposal': op(
    'agent.proposal.reject',
    ADMINS,
    'tenant',
  ),
  'AgentProposalController.createProposal': op(
    'agent.proposal.create',
    ADMINS,
    'tenant',
    ['agent_policy'],
  ),
  'AgentProposalController.submitPendingAction': op(
    'agent.proposal.submit',
    BACK_OFFICE,
    'tenant',
    ['agent_policy'],
  ),
  'AgentActionLogController.findAll': op('agent.action.read', ADMINS, 'tenant'),
  'AgentActionLogController.findByTraceId': op(
    'agent.action.read',
    ADMINS,
    'tenant',
  ),
  'AgentSupervisionController.listTriage': op(
    'agent.supervision.read',
    ADMINS,
    'tenant',
  ),
  'DomainEventFeedController.list': op(
    'agent.domain_event.read',
    ADMINS,
    'tenant',
  ),
  'DecisionShadowLogController.findAll': op(
    'decision_shadow_log.read',
    ADMINS,
    'tenant',
  ),
  'AuditController.findAll': op('audit.read', BACK_OFFICE_DEMO, 'tenant'),
  'NotificationOutboxReplayController.replayFailed': op(
    'notification.outbox.replay',
    ADMINS,
    'tenant',
  ),
  'SearchController.search': op('search.global', EVERY_ROLE, 'site'),
};
