export type EscapeHtml = (value: unknown) => string;

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    str = String(value);
  } else if (value instanceof Date) {
    str = value.toISOString();
  } else {
    str = JSON.stringify(value) ?? '';
  }

  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const buildPdfTableStyles = (): string => `
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th { text-align: left; border-bottom: 1px solid #d1d5db; }
  td { border-bottom: 1px solid #f3f4f6; }
`;

export const buildBasePdfStyles = (): string => `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    font-size: 12px;
    color: #111827;
    line-height: 1.45;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .section { margin-bottom: 18px; }
  .section-title {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #374151;
    border-bottom: 1px solid #e5e7eb;
    padding-bottom: 6px;
    margin-bottom: 10px;
  }
  ${buildPdfTableStyles()}
`;

export function buildPdfFooterTemplate(titleHtml: string): string {
  return `
      <div style="
        width: 100%;
        padding: 0 50px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 9px;
        color: #6b7280;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <span>${titleHtml}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;
}
