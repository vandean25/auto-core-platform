import { StreamableFile } from '@nestjs/common';
import { buildContentDisposition } from './document-branding-upload.rules.js';

export function streamReadyAssetContent(params: {
  bytes: Buffer;
  contentType: string;
  purpose: 'SOURCE' | 'LOGO';
  originalFilename: string | null;
}) {
  const disposition = params.purpose === 'SOURCE' ? 'attachment' : 'inline';
  const filename =
    params.originalFilename ??
    (params.contentType === 'application/pdf'
      ? 'document-branding-source.pdf'
      : 'document-branding-asset.png');
  return new StreamableFile(params.bytes, {
    type: params.contentType,
    disposition: buildContentDisposition(disposition, filename),
    length: params.bytes.byteLength,
  });
}

export function streamAssetPagePreview(bytes: Buffer) {
  return new StreamableFile(bytes, {
    type: 'image/png',
    disposition: buildContentDisposition(
      'inline',
      'document-branding-preview.png',
    ),
    length: bytes.byteLength,
  });
}
