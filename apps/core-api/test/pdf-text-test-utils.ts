import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Page count and joined text layer of a rendered PDF, for wording and totals assertions. */
export async function readPdfText(pdfBytes: Buffer) {
  const loadingTask = getDocument({ data: new Uint8Array(pdfBytes) });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pages = await Promise.all(
    Array.from({ length: pageCount }, async (_, index) => {
      const page = await document.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ');
    }),
  );
  await loadingTask.destroy();
  return { pageCount, text: pages.join(' ') };
}

export function normalizePdfText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Letters and digits only. pdf.js drops some punctuation glyphs of the unbranded invoice and credit
 * note text layers, so wording on those documents is compared on letters and digits.
 */
export function lettersAndDigits(value: string): string {
  return value.replace(/[^\p{L}\p{N}]/gu, '');
}
