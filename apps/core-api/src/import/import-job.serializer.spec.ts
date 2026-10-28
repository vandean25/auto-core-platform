import { buildImportErrorReportCsv } from './import-job.serializer.js';

type ReportRow = {
  row_no: number;
  external_id: string | null;
  errors_json: Array<{ code: string; message: string; field?: string }>;
  source_cells: string[];
};

type ReportOptions = {
  headers: string[];
  mapping: Record<string, string>;
  locale: 'de' | 'en';
  includeHeader?: boolean;
  normalizedFallback?: boolean;
};

const buildCsv: (rows: ReportRow[], options: ReportOptions) => string =
  buildImportErrorReportCsv;

const row: ReportRow = {
  row_no: 2,
  external_id: null,
  errors_json: [
    {
      code: 'IMPORT_EXTERNAL_ID_REQUIRED',
      message: 'external_id is required',
      field: 'external_id',
    },
  ],
  source_cells: ['', '  Sample; "quoted"\nsecond line  ', 'unmapped'],
};
const options: ReportOptions = {
  headers: ['Source ID', 'Original description', 'Unused column'],
  mapping: { external_id: 'Source ID' },
  locale: 'de',
};

describe('import error CSV', () => {
  it('preserves original headers, whitespace and escaped cells with German messages', () => {
    expect(buildCsv([row], options)).toBe(
      '\uFEFFrow_no;Source ID;Original description;Unused column;error_field;error_message;error_code\r\n' +
        '2;;"  Sample; ""quoted""\nsecond line  ";unmapped;Source ID;Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.;IMPORT_EXTERNAL_ID_REQUIRED\r\n',
    );
  });

  it('uses English messages rather than stored exception text', () => {
    expect(
      buildCsv([{ ...row, source_cells: ['', '', ''] }], {
        ...options,
        locale: 'en',
      }),
    ).toContain(
      ';Source ID;The external ID is missing. Enter an ID for this row.;IMPORT_EXTERNAL_ID_REQUIRED\r\n',
    );
  });

  it('joins multiple issues on one row with the corresponding source fields', () => {
    const csv = buildCsv(
      [
        {
          ...row,
          errors_json: [
            ...row.errors_json,
            { code: 'IMPORT_APPLY_FAILED', message: 'private details' },
          ],
        },
      ],
      options,
    );
    expect(csv).toContain(
      'Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile. | Die Zeile konnte nicht übernommen werden. Bitte versuchen Sie den Import erneut.',
    );
    expect(csv).toContain('IMPORT_EXTERNAL_ID_REQUIRED | IMPORT_APPLY_FAILED');
    expect(csv).not.toContain('private details');
  });

  it.each([
    [
      'de',
      'Die Zeile konnte nicht importiert werden. Bitte prüfen Sie die Werte und versuchen Sie es erneut.',
    ],
    ['en', 'This row could not be imported. Check the values and try again.'],
  ] as const)(
    'provides a readable fallback in %s for an unknown code',
    (locale, message) => {
      const csv = buildCsv(
        [
          {
            ...row,
            errors_json: [
              {
                code: 'UNKNOWN_SYNTHETIC_CODE',
                message: 'sensitive raw exception',
              },
            ],
          },
        ],
        { ...options, locale },
      );
      expect(csv).toContain(`;;${message};UNKNOWN_SYNTHETIC_CODE\r\n`);
      expect(csv).not.toContain('sensitive raw exception');
    },
  );

  it('escapes unusual headers and protects cells from spreadsheet formulas', () => {
    const csv = buildCsv(
      [{ ...row, source_cells: ['=1+1', '+123', 'value\rbreak'] }],
      { ...options, headers: ['ID;number', '"Description"', 'Line\nbreak'] },
    );
    expect(csv).toContain(
      'row_no;"ID;number";"""Description""";"Line\nbreak";',
    );
    expect(csv).toContain('2;\'=1+1;\'+123;"value\rbreak";');
  });

  it('keeps original apostrophes distinguishable from spreadsheet protection', () => {
    expect(
      buildCsv(
        [{ ...row, source_cells: ["'original", "'+123", '+ID'] }],
        options,
      ),
    ).toContain("2;''original;''+123;'+ID;");
  });

  it('adds a localized note when only normalized values remain', () => {
    const csv = buildCsv([{ ...row, source_cells: ['saved-id', '', ''] }], {
      ...options,
      normalizedFallback: true,
      locale: 'en',
    });
    expect(csv).toContain('error_code;note\r\n');
    expect(csv).toContain(
      'The original file is no longer available. This row contains only the saved, normalized values.',
    );
  });

  it('emits only data lines for subsequent stream chunks', () => {
    const csv = buildCsv([{ ...row, source_cells: ['', '', ''] }], {
      ...options,
      includeHeader: false,
    });
    expect(csv).toBe(
      '2;;;;Source ID;Die externe Nummer fehlt. Bitte ergänzen Sie die Nummer in dieser Zeile.;IMPORT_EXTERNAL_ID_REQUIRED\r\n',
    );
  });
});
