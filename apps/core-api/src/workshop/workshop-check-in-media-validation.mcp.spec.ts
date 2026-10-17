import { BadRequestException } from '@nestjs/common';
import { assertMcpWorkshopMediaUploadDeclared } from './workshop-mcp-media-validation.js';

describe('assertMcpWorkshopMediaUploadDeclared', () => {
  it('accepts allowed image mime types within size cap', () => {
    expect(() =>
      assertMcpWorkshopMediaUploadDeclared('image/jpeg', 1024),
    ).not.toThrow();
    expect(() =>
      assertMcpWorkshopMediaUploadDeclared('image/heic', 1024),
    ).not.toThrow();
  });

  it('rejects unsupported mime types', () => {
    expect(() =>
      assertMcpWorkshopMediaUploadDeclared('video/mp4', 1024),
    ).toThrow(BadRequestException);
  });

  it('rejects oversize declarations', () => {
    expect(() =>
      assertMcpWorkshopMediaUploadDeclared(
        'image/png',
        50 * 1024 * 1024 + 1,
      ),
    ).toThrow(BadRequestException);
  });
});
