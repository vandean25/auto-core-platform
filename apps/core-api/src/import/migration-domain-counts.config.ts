import type { MigrationCsvFileName } from './migration-csv-dictionary.js';

export type MigrationDomainCountSpec = {
  domainKey: string;
  fileName: MigrationCsvFileName;
  enumField: string;
  enumKeys: readonly string[];
};

export const MIGRATION_V11_DOMAIN_COUNT_SPECS: readonly MigrationDomainCountSpec[] =
  [
    {
      domainKey: 'vehicle_parties',
      fileName: 'vehicle_parties.csv',
      enumField: 'role',
      enumKeys: [
        'OWNER',
        'DRIVER',
        'USER',
        'BILL_TO',
        'LEASING',
        'INSURANCE',
        'WARRANTY_PROVIDER',
        'SERVICE_CONTRACT',
        'PREVIOUS_OWNER',
      ],
    },
    {
      domainKey: 'vehicle_due_dates',
      fileName: 'vehicle_due_dates.csv',
      enumField: 'kind',
      enumKeys: ['INSPECTION_57A', 'SERVICE'],
    },
    {
      domainKey: 'vehicle_notices',
      fileName: 'vehicle_notices.csv',
      enumField: 'type',
      enumKeys: [
        'CAMPAIGN',
        'RECALL',
        'REMARK',
        'WARNING',
        'SERVICE_DUE',
      ],
    },
    {
      domainKey: 'tyre_sets',
      fileName: 'tyre_sets.csv',
      enumField: 'status',
      enumKeys: ['IN_STORAGE', 'ON_VEHICLE', 'RETURNED', 'DISPOSED'],
    },
    {
      domainKey: 'open_orders',
      fileName: 'open_orders.csv',
      enumField: 'kind',
      enumKeys: ['ORDER', 'QUOTE', 'SCHEDULED'],
    },
    {
      domainKey: 'open_order_lines',
      fileName: 'open_order_lines.csv',
      enumField: 'line_kind',
      enumKeys: ['LABOR', 'PART', 'FEE', 'TEXT'],
    },
    {
      domainKey: 'legacy_documents',
      fileName: 'legacy_documents.csv',
      enumField: 'doc_type',
      enumKeys: [
        'INVOICE',
        'CREDIT_MEMO',
        'SERVICE_ORDER',
        'QUOTE',
        'WARRANTY_CLAIM',
        'SERVICE_CONTRACT',
        'TYRE_ORDER',
        'VEHICLE_HISTORY_SUMMARY',
      ],
    },
    {
      domainKey: 'open_items',
      fileName: 'open_items.csv',
      enumField: 'doc_type',
      enumKeys: [
        'INVOICE',
        'CREDIT_MEMO',
        'PAYMENT',
        'REFUND',
        'REMINDER_FEE',
      ],
    },
  ];
