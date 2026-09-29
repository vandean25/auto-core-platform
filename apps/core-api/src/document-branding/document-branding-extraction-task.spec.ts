import { UnauthorizedException } from '@nestjs/common';
import {
  signDocumentBrandingExtractionTask,
  verifyDocumentBrandingExtractionTask,
} from './document-branding-extraction-task.js';

describe('document branding extraction task payload', () => {
  const secret = 'test-worker-secret';
  const claims = {
    extractionId: 'extraction-1',
    legalEntityId: 'entity-1',
    tenantId: 'tenant-1',
    expectedAttemptCount: 0,
  };

  it('round-trips a signed tenant and entity binding', () => {
    const payload = signDocumentBrandingExtractionTask(claims, secret);

    expect(verifyDocumentBrandingExtractionTask(payload, secret)).toEqual(
      claims,
    );
  });

  it('rejects a payload whose route identity was changed after signing', () => {
    const payload = signDocumentBrandingExtractionTask(claims, secret);

    expect(() =>
      verifyDocumentBrandingExtractionTask(
        { ...payload, legalEntityId: 'entity-other' },
        secret,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects an invalid attempt generation', () => {
    const payload = signDocumentBrandingExtractionTask(claims, secret);

    expect(() =>
      verifyDocumentBrandingExtractionTask(
        { ...payload, expectedAttemptCount: -1 },
        secret,
      ),
    ).toThrow(UnauthorizedException);
  });
});
