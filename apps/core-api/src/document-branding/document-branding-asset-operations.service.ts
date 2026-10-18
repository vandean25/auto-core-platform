import { Injectable } from '@nestjs/common';
import { DocumentBrandingAssetReaderService } from './document-branding-asset-reader.service.js';
import { DocumentBrandingUploadAdmissionService } from './document-branding-upload-admission.service.js';

@Injectable()
export class DocumentBrandingAssetOperations {
  constructor(
    private readonly admission: DocumentBrandingUploadAdmissionService,
    private readonly reader: DocumentBrandingAssetReaderService,
  ) {}

  async upload(
    legalEntityId: string,
    purposeValue: string,
    file: Express.Multer.File | undefined,
  ) {
    return this.admission.admit(legalEntityId, purposeValue, file);
  }

  async getAsset(legalEntityId: string, assetId: string) {
    return this.reader.getAsset(legalEntityId, assetId);
  }

  async getAssetPagePreview(legalEntityId: string, assetId: string) {
    return this.reader.getAssetPagePreview(legalEntityId, assetId);
  }

  async getAssetContent(legalEntityId: string, assetId: string) {
    return this.reader.getAssetContent(legalEntityId, assetId);
  }
}
