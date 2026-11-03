import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import {
  DOCUMENT_BRAND_LOGO_MAX_BYTES,
  DOCUMENT_BRAND_PAYLOAD_SIZE_LIMIT_MIB,
  DOCUMENT_BRAND_SOURCE_MAX_BYTES,
  formatLogoUploadRequirement,
} from './document-branding-limits.js';
import {
  assertPurposeSupportsMime,
  buildContentDisposition,
  detectMimeType,
  mapDocumentBrandAssetResponse,
  requirePurpose,
  requireUpload,
  sanitizeFilename,
} from './document-branding-upload.rules.js';

describe('document branding upload rules', () => {
  it('detects PNG and PDF by signature and treats anything else as opaque', () => {
    expect(
      detectMimeType(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0])),
    ).toBe('image/png');
    expect(detectMimeType(Buffer.from('%PDF-1.7'))).toBe('application/pdf');
    expect(detectMimeType(Buffer.from('plain text'))).toBe(
      'application/octet-stream',
    );
  });

  it('replaces path and quote characters in filenames and drops empty names', () => {
    expect(sanitizeFilename('  brand\\logo.png  ')).toBe('brand logo.png');
    expect(sanitizeFilename('   ')).toBeNull();
  });

  it('builds an ASCII fallback and a UTF-8 filename for content disposition', () => {
    expect(buildContentDisposition('attachment', 'Angebot ü.pdf')).toBe(
      `attachment; filename="Angebot _.pdf"; filename*=UTF-8''${encodeURIComponent('Angebot ü.pdf')}`,
    );
  });

  it('requires a file and enforces the purpose size limit', () => {
    expect(() => requireUpload(undefined, 'LOGO')).toThrow(
      BadRequestException,
    );
    const oversized = {
      buffer: Buffer.alloc(1),
      size: DOCUMENT_BRAND_LOGO_MAX_BYTES + 1,
    } as unknown as Express.Multer.File;
    expect(() => requireUpload(oversized, 'LOGO')).toThrow(
      PayloadTooLargeException,
    );
  });

  it.each([
    {
      purpose: 'LOGO' as const,
      maxBytes: DOCUMENT_BRAND_LOGO_MAX_BYTES,
      code: 'BRAND_LOGO_TOO_LARGE',
      responseExtras: {
        message: formatLogoUploadRequirement(),
        maxMiB: DOCUMENT_BRAND_PAYLOAD_SIZE_LIMIT_MIB,
      },
    },
    {
      purpose: 'SOURCE' as const,
      maxBytes: DOCUMENT_BRAND_SOURCE_MAX_BYTES,
      code: 'BRAND_UPLOAD_TOO_LARGE',
      responseExtras: {},
    },
  ])(
    'names the purpose-specific code and the $purpose byte limit for an oversized upload',
    ({ purpose, maxBytes, code, responseExtras }) => {
      const oversized = {
        buffer: Buffer.alloc(1),
        size: maxBytes + 1,
      } as unknown as Express.Multer.File;
      let thrown: PayloadTooLargeException | undefined;
      try {
        requireUpload(oversized, purpose);
      } catch (error) {
        thrown = error as PayloadTooLargeException;
      }
      expect(thrown).toBeInstanceOf(PayloadTooLargeException);
      const response = thrown?.getResponse() as Record<string, unknown>;
      expect(response).toMatchObject({ code, ...responseExtras });
      if (!responseExtras.maxMiB) {
        expect(response.maxMiB).toBeUndefined();
      }
    },
  );

  it('accepts only PNG logos and PNG or PDF sources', () => {
    expect(() =>
      assertPurposeSupportsMime('LOGO', 'application/pdf'),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      assertPurposeSupportsMime('SOURCE', 'application/octet-stream'),
    ).toThrow(UnsupportedMediaTypeException);
    expect(() =>
      assertPurposeSupportsMime('SOURCE', 'application/pdf'),
    ).not.toThrow();
  });

  it('requires a purpose of SOURCE or LOGO', () => {
    expect(requirePurpose('LOGO')).toBe('LOGO');
    expect(() => requirePurpose('OTHER')).toThrow(BadRequestException);
  });

  it('maps a stored asset to the API response shape', () => {
    expect(
      mapDocumentBrandAssetResponse({
        id: 'asset-1',
        purpose: 'LOGO',
        state: 'READY',
        detected_mime_type: 'image/png',
        byte_length: 8,
        pixel_width: 2,
        pixel_height: 2,
        failure_code: null,
        original_filename: 'brand.png',
        preview_object_key: 'preview.png',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        expires_at: null,
      }),
    ).toMatchObject({
      detectedMimeType: 'image/png',
      byteLength: 8,
      pagePreviewAvailable: true,
      expiresAt: null,
    });
  });
});
