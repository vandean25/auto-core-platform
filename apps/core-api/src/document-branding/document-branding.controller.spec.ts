import { HttpException, HttpStatus } from '@nestjs/common';
import { DocumentBrandingController } from './document-branding.controller.js';
import { DocumentBrandingService } from './document-branding.service.js';
import { DocumentBrandingUploadService } from './document-branding-upload.service.js';

describe('DocumentBrandingController quota headers', () => {
  const branding = {
    preview: jest.fn(),
  } as unknown as DocumentBrandingService;
  const uploads = {
    upload: jest.fn(),
  } as unknown as DocumentBrandingUploadService;
  const response = { setHeader: jest.fn() };
  const controller = new DocumentBrandingController(branding, uploads);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets Retry-After on preview quota responses', async () => {
    jest
      .mocked(branding.preview)
      .mockRejectedValue(
        new HttpException(
          { code: 'BRAND_PREVIEW_QUOTA_EXCEEDED' },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );

    await expect(
      controller.preview('entity-1', {} as never, response as never),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('sets Retry-After on asset upload quota responses', async () => {
    jest
      .mocked(uploads.upload)
      .mockRejectedValue(
        new HttpException(
          { code: 'BRAND_UPLOAD_QUOTA_EXCEEDED' },
          HttpStatus.TOO_MANY_REQUESTS,
        ),
      );

    await expect(
      controller.uploadAsset('entity-1', 'LOGO', undefined, response as never),
    ).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '3600');
  });
});
