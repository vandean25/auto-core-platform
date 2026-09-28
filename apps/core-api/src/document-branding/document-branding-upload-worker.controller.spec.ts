import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator.js';
import { DocumentBrandingUploadWorkerController } from './document-branding-upload-worker.controller.js';

describe('DocumentBrandingUploadWorkerController', () => {
  it('bypasses Firebase JWT auth while retaining task guards', () => {
    expect(
      Reflect.getMetadata(
        IS_PUBLIC_KEY,
        DocumentBrandingUploadWorkerController,
      ),
    ).toBe(true);
  });
});
