import { UnauthorizedException } from '@nestjs/common';
import {
  signDocumentBrandingUploadTask,
  verifyDocumentBrandingUploadTask,
} from './document-branding-upload-task.js';

describe('document branding upload task payload', () => {
  const claims = { assetId: 'asset-1', tenantId: 'tenant-1' };

  it('signs the asset and tenant claims for dedicated worker verification', () => {
    const payload = signDocumentBrandingUploadTask(claims, 'worker-secret');
    expect(verifyDocumentBrandingUploadTask(payload, 'worker-secret')).toEqual(
      claims,
    );
  });

  it('rejects altered task claims', () => {
    const payload = signDocumentBrandingUploadTask(claims, 'worker-secret');
    expect(() =>
      verifyDocumentBrandingUploadTask(
        { ...payload, tenantId: 'other-tenant' },
        'worker-secret',
      ),
    ).toThrow(UnauthorizedException);
  });
});
