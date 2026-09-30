export const DOCUMENT_BRAND_DECORATIVE_TEXT_MAX_CODE_POINTS = 120;

export const DOCUMENT_BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const DOCUMENT_BRAND_SOURCE_MAX_BYTES = 10 * 1024 * 1024;

export const DOCUMENT_BRAND_LOGO_MIME_TYPES = ['image/png'] as const;
export const DOCUMENT_BRAND_SOURCE_MIME_TYPES = [
  'image/png',
  'application/pdf',
] as const;

const LOGO_LABELS: Record<
  (typeof DOCUMENT_BRAND_LOGO_MIME_TYPES)[number],
  string
> = {
  'image/png': 'PNG',
};

const SOURCE_LABELS: Record<
  (typeof DOCUMENT_BRAND_SOURCE_MIME_TYPES)[number],
  string
> = {
  'image/png': 'PNG',
  'application/pdf': 'PDF',
};

function formatMaxMegabytes(maxBytes: number): string {
  const mib = maxBytes / (1024 * 1024);
  return Number.isInteger(mib) ? `${mib}` : mib.toFixed(1);
}

export function formatMimeTypeList(
  mimeTypes: readonly string[],
  labels: Record<string, string>,
): string {
  const unique = [...new Set(mimeTypes.map((mime) => labels[mime] ?? mime))];
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} or ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} or ${unique.at(-1)}`;
}

export function logoFileInputAccept(): string {
  return [...DOCUMENT_BRAND_LOGO_MIME_TYPES, '.png'].join(',');
}

export function sourceFileInputAccept(): string {
  return [...DOCUMENT_BRAND_SOURCE_MIME_TYPES, '.pdf', '.png'].join(',');
}

export function formatLogoUploadRequirement(): string {
  const types = formatMimeTypeList(DOCUMENT_BRAND_LOGO_MIME_TYPES, LOGO_LABELS);
  return `Logo must be ${types} (max ${formatMaxMegabytes(DOCUMENT_BRAND_LOGO_MAX_BYTES)} MiB).`;
}

export function formatSourceUploadRequirement(): string {
  const types = formatMimeTypeList(
    DOCUMENT_BRAND_SOURCE_MIME_TYPES,
    SOURCE_LABELS,
  );
  return `Letterhead source must be ${types} (max ${formatMaxMegabytes(DOCUMENT_BRAND_SOURCE_MAX_BYTES)} MiB).`;
}

export function documentBrandProfileCapabilities(extractionAvailable: boolean) {
  return {
    extractionAvailable,
    theme: {
      decorativeTextMaxCodePoints:
        DOCUMENT_BRAND_DECORATIVE_TEXT_MAX_CODE_POINTS,
    },
    uploads: {
      logo: {
        maxBytes: DOCUMENT_BRAND_LOGO_MAX_BYTES,
        mimeTypes: [...DOCUMENT_BRAND_LOGO_MIME_TYPES],
        accept: logoFileInputAccept(),
        requirementLabel: formatLogoUploadRequirement(),
      },
      source: {
        maxBytes: DOCUMENT_BRAND_SOURCE_MAX_BYTES,
        mimeTypes: [...DOCUMENT_BRAND_SOURCE_MIME_TYPES],
        accept: sourceFileInputAccept(),
        requirementLabel: formatSourceUploadRequirement(),
      },
    },
  };
}
