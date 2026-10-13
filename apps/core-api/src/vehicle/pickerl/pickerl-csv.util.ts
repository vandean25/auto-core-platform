import { csvEscape } from '../../common/utils/csv-export.util.js';

export const PICKERL_DUE_CSV_HEADER =
  'plate,vehicle,customer,due_month,status,last_inspected_on,phone,email';

export interface PickerlDueCsvRow {
  plate: string | null;
  make: string;
  model: string;
  customer: {
    company_name: string | null;
    first_name: string;
    last_name: string;
    phone: string | null;
    email: string | null;
  } | null;
  pickerl_due: {
    due_month: string | null;
    status: string;
    last_inspected_on?: string | null;
  };
}

export function buildPickerlDueCsv(rows: readonly PickerlDueCsvRow[]): string {
  const lines = rows.map(toPickerlDueCsvLine);
  return [PICKERL_DUE_CSV_HEADER, ...lines].join('\n');
}

function toPickerlDueCsvLine(row: PickerlDueCsvRow): string {
  return [
    csvEscape(row.plate),
    csvEscape(`${row.make} ${row.model}`),
    csvEscape(toCustomerName(row.customer)),
    csvEscape(row.pickerl_due.due_month),
    csvEscape(row.pickerl_due.status),
    csvEscape(row.pickerl_due.last_inspected_on ?? ''),
    csvEscape(row.customer?.phone),
    csvEscape(row.customer?.email),
  ].join(',');
}

function toCustomerName(customer: PickerlDueCsvRow['customer']): string {
  if (!customer) {
    return '';
  }
  if (customer.company_name) {
    return customer.company_name;
  }
  return `${customer.first_name} ${customer.last_name}`.trim();
}
