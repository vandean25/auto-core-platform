import {
  PICKERL_DUE_CSV_HEADER,
  buildPickerlDueCsv,
  type PickerlDueCsvRow,
} from './pickerl-csv.util.js';

const companyRow: PickerlDueCsvRow = {
  plate: 'W-123AB',
  make: 'Volkswagen',
  model: 'Golf',
  customer: {
    company_name: 'Demo Autohaus GmbH',
    first_name: 'Ignored',
    last_name: 'Ignored',
    phone: '0043 1 000 000',
    email: 'office@example.test',
  },
  pickerl_due: {
    due_month: '2026-11',
    status: 'DUE_SOON',
    last_inspected_on: '2025-11-02',
  },
};

describe('buildPickerlDueCsv', () => {
  it('returns only the header when there are no rows', () => {
    expect(buildPickerlDueCsv([])).toBe(PICKERL_DUE_CSV_HEADER);
  });

  it('uses the company name and contact details for company customers', () => {
    expect(buildPickerlDueCsv([companyRow])).toBe(
      [
        PICKERL_DUE_CSV_HEADER,
        'W-123AB,Volkswagen Golf,Demo Autohaus GmbH,2026-11,DUE_SOON,2025-11-02,0043 1 000 000,office@example.test',
      ].join('\n'),
    );
  });

  it('builds a trimmed first and last name for private customers', () => {
    const [, line] = buildPickerlDueCsv([
      {
        ...companyRow,
        plate: 'W-2',
        make: 'Audi',
        model: 'A4',
        customer: {
          company_name: null,
          first_name: 'Max',
          last_name: 'Mustermann',
          phone: null,
          email: null,
        },
        pickerl_due: { due_month: null, status: 'UNKNOWN' },
      },
    ]).split('\n');

    expect(line).toBe('W-2,Audi A4,Max Mustermann,,UNKNOWN,,,');
  });

  it('leaves customer columns empty when the vehicle has no customer', () => {
    const [, line] = buildPickerlDueCsv([
      { ...companyRow, customer: null, plate: 'P-9' },
    ]).split('\n');

    expect(line).toBe('P-9,Volkswagen Golf,,2026-11,DUE_SOON,2025-11-02,,');
  });

  it('quotes values that contain commas or quotes', () => {
    const [, line] = buildPickerlDueCsv([
      {
        ...companyRow,
        customer: { ...companyRow.customer!, company_name: 'Acme, "West"' },
      },
    ]).split('\n');

    expect(line).toContain('"Acme, ""West"""');
  });

  it('neutralizes spreadsheet formulas in exported cells', () => {
    const [, line] = buildPickerlDueCsv([{ ...companyRow, plate: '=HYPERLINK' }]).split(
      '\n',
    );

    expect(line.startsWith("'=HYPERLINK,")).toBe(true);
  });
});
