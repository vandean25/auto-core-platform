import { Injectable } from '@nestjs/common';
import type {
  SaveDocumentBrandDraftDto,
  SaveDocumentBrandDraftSourceDto,
} from './dto/document-branding.dto.js';
import type { DocumentBrandSample } from './document-branding-preview.js';
import { DocumentBrandingConfirmationService } from './document-branding-confirmation.service.js';
import { DocumentBrandingDraftService } from './document-branding-draft.service.js';
import { DocumentBrandingProfilePreviewService } from './document-branding-profile-preview.service.js';
import { DocumentBrandingProfileStore } from './document-branding-profile-store.service.js';

/**
 * Public entry point for document branding. Each method delegates to a focused
 * collaborator; the signatures are the contract the controller depends on.
 */
@Injectable()
export class DocumentBrandingService {
  constructor(
    private readonly profiles: DocumentBrandingProfileStore,
    private readonly drafts: DocumentBrandingDraftService,
    private readonly confirmations: DocumentBrandingConfirmationService,
    private readonly previews: DocumentBrandingProfilePreviewService,
  ) {}

  async getProfile(legalEntityId: string) {
    return this.profiles.getProfile(legalEntityId);
  }

  async setDraftSource(
    legalEntityId: string,
    dto: SaveDocumentBrandDraftSourceDto,
  ) {
    return this.drafts.setDraftSource(legalEntityId, dto);
  }

  async removeDraftSource(legalEntityId: string, expectedRevision: number) {
    return this.drafts.removeDraftSource(legalEntityId, expectedRevision);
  }

  async saveDraft(legalEntityId: string, dto: SaveDocumentBrandDraftDto) {
    return this.drafts.saveDraft(legalEntityId, dto);
  }

  async discardDraft(legalEntityId: string, expectedRevision: number) {
    return this.drafts.discardDraft(legalEntityId, expectedRevision);
  }

  async confirm(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmations.confirm(legalEntityId, expectedRevision, key);
  }

  async reset(legalEntityId: string, expectedRevision: number, key: string) {
    return this.confirmations.reset(legalEntityId, expectedRevision, key);
  }

  async preview(
    legalEntityId: string,
    theme: unknown,
    sample: DocumentBrandSample,
  ) {
    return this.previews.preview(legalEntityId, theme, sample);
  }
}
