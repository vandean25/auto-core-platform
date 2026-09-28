import { DocumentBrandingPdfParser } from './document-branding-pdf-parser.js';

describe('DocumentBrandingPdfParser', () => {
  const parser = new DocumentBrandingPdfParser();

  it('rasterizes only the first page within the approved raster bounds', async () => {
    const result = await parser.validateAndRasterize(
      createPdf({ pageCount: 2 }),
    );

    expect(result).toMatchObject({
      pageCount: 2,
      width: expect.any(Number),
      height: expect.any(Number),
      warning: 'PDF_ADDITIONAL_PAGES_IGNORED',
    });
    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
    expect(result.width * result.height).toBeLessThanOrEqual(4_000_000);
    expect(result.raster.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  });

  it('rejects encrypted PDFs', async () => {
    await expect(
      parser.validateAndRasterize(createPdf({ encrypted: true })),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PDF_ENCRYPTED' },
    });
  });

  it('rejects PDF actions', async () => {
    await expect(
      parser.validateAndRasterize(createPdf({ openAction: true })),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PDF_ACTIONS' },
    });
  });

  it('rejects embedded files', async () => {
    await expect(
      parser.validateAndRasterize(createPdf({ embeddedFile: true })),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PDF_EMBEDDED_FILE' },
    });
  });

  it('rejects documents with more than five pages before rasterizing', async () => {
    await expect(
      parser.validateAndRasterize(createPdf({ pageCount: 6 })),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_PDF_PAGE_LIMIT' },
    });
  });

  it('publishes the exact isolated-process limits', () => {
    expect(DocumentBrandingPdfParser.memoryLimitBytes).toBe(256 * 1024 * 1024);
    expect(DocumentBrandingPdfParser.wallTimeLimitMs).toBe(15_000);
  });
});

function createPdf(
  options: {
    pageCount?: number;
    encrypted?: boolean;
    openAction?: boolean;
    embeddedFile?: boolean;
  } = {},
): Buffer {
  const pageCount = options.pageCount ?? 1;
  const pageReferences = Array.from(
    { length: pageCount },
    (_, index) => `${index + 3} 0 R`,
  ).join(' ');
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R${options.openAction ? ` /OpenAction ${pageCount + 3} 0 R` : ''}${options.embeddedFile ? ` /Names << /EmbeddedFiles << /Names [(source.bin) ${pageCount + 3} 0 R] >> >>` : ''} >>`,
    `<< /Type /Pages /Kids [${pageReferences}] /Count ${pageCount} >>`,
    ...Array.from(
      { length: pageCount },
      (_, index) =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> >>`,
    ),
  ];
  if (options.openAction) {
    objects.push('<< /S /JavaScript /JS (app.alert) >>');
  }
  if (options.embeddedFile) {
    objects.push(
      '<< /Type /Filespec /F (source.bin) /EF << /F ' +
        `${pageCount + 4} 0 R >> >>`,
    );
    objects.push('<< /Type /EmbeddedFile /Length 0 >>\nstream\n\nendstream');
  }
  if (options.encrypted) {
    objects.push(
      `<< /Filter /Standard /V 1 /R 2 /O <${'00'.repeat(32)}> /U <${'00'.repeat(32)}> /P -4 >>`,
    );
  }

  const chunks = ['%PDF-1.7\n%fixture\n'];
  const offsets = [0];
  let currentOffset = Buffer.byteLength(chunks[0]);
  objects.forEach((object, index) => {
    offsets.push(currentOffset);
    const serialized = `${index + 1} 0 obj\n${object}\nendobj\n`;
    chunks.push(serialized);
    currentOffset += Buffer.byteLength(serialized);
  });

  const xrefOffset = currentOffset;
  const xref = [
    `xref\n0 ${objects.length + 1}\n`,
    '0000000000 65535 f \n',
    ...offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`),
  ].join('');
  const encryptReference = options.encrypted
    ? ` /Encrypt ${objects.length} 0 R`
    : '';
  chunks.push(
    `${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptReference} >>\nstartxref\n${xrefOffset}\n%%EOF`,
  );
  return Buffer.from(chunks.join(''), 'ascii');
}
