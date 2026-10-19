/** Draft 2020-12 manifest schemas from migration-csv-format.md / v1.0.md */

export const MIGRATION_MANIFEST_SCHEMA_V10 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'ACP canonical migration manifest v1.0',
  type: 'object',
  additionalProperties: false,
  required: [
    'format_version',
    'source_name',
    'source_system',
    'source_company_code',
    'extracted_at',
    'cutover_date',
    'currency',
    'files',
    'control_totals',
  ],
  properties: {
    format_version: { const: '1.0' },
    source_name: { $ref: '#/$defs/namespaceCode' },
    source_system: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9_-]{0,63}:[a-z0-9][a-z0-9_-]{0,63}$',
    },
    source_company_code: { $ref: '#/$defs/namespaceCode' },
    extracted_at: {
      type: 'string',
      format: 'date-time',
      pattern:
        '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$',
    },
    cutover_date: { type: 'string', format: 'date' },
    currency: { const: 'EUR' },
    files: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: { $ref: '#/$defs/fileEntry' },
    },
    control_totals: {
      type: 'object',
      additionalProperties: false,
      required: [
        'counts_by_type',
        'stock_value',
        'open_items',
        'document_totals',
      ],
      properties: {
        counts_by_type: { $ref: '#/$defs/countsByType' },
        stock_value: {
          oneOf: [{ type: 'null' }, { $ref: '#/$defs/amount' }],
        },
        open_items: {
          oneOf: [{ type: 'null' }, { $ref: '#/$defs/signedAmount' }],
        },
        document_totals: {
          type: 'array',
          items: { $ref: '#/$defs/documentTotal' },
        },
      },
    },
  },
  $defs: {
    namespaceCode: {
      type: 'string',
      pattern: '^[a-z0-9][a-z0-9_-]{0,63}$',
    },
    amount: {
      type: 'string',
      pattern: '^(0|[1-9][0-9]{0,17})\\.[0-9]{2}$',
    },
    signedAmount: {
      type: 'string',
      pattern: '^-?(0|[1-9][0-9]{0,17})\\.[0-9]{2}$',
      not: { const: '-0.00' },
    },
    fileName: {
      enum: [
        'customers.csv',
        'vehicles.csv',
        'vendors.csv',
        'parts.csv',
        'stock_opening.csv',
        'labor_operations.csv',
        'labor_standard_times.csv',
        'labor_price_groups.csv',
        'labor_packages.csv',
        'labor_package_items.csv',
        'vehicle_parties.csv',
        'vehicle_due_dates.csv',
        'vehicle_notices.csv',
        'tyre_sets.csv',
        'open_orders.csv',
        'open_order_tasks.csv',
        'open_order_lines.csv',
        'legacy_documents.csv',
        'legacy_document_lines.csv',
        'open_items.csv',
      ],
    },
    fileEntry: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'sha256', 'row_count'],
      properties: {
        name: { $ref: '#/$defs/fileName' },
        sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
        row_count: {
          type: 'integer',
          minimum: 0,
          maximum: 2147483647,
        },
      },
    },
    countsByType: {
      type: 'object',
      minProperties: 1,
      maxProperties: 20,
      propertyNames: {
        enum: [
          'customers',
          'vehicles',
          'vendors',
          'parts',
          'stock_opening',
          'labor_operations',
          'labor_standard_times',
          'labor_price_groups',
          'labor_packages',
          'labor_package_items',
          'vehicle_parties',
          'vehicle_due_dates',
          'vehicle_notices',
          'tyre_sets',
          'open_orders',
          'open_order_tasks',
          'open_order_lines',
          'legacy_documents',
          'legacy_document_lines',
          'open_items',
        ],
      },
      additionalProperties: {
        type: 'integer',
        minimum: 0,
        maximum: 2147483647,
      },
    },
    documentTotal: {
      type: 'object',
      additionalProperties: false,
      required: ['year_month', 'doc_type', 'row_count', 'net', 'vat', 'gross'],
      properties: {
        year_month: {
          type: 'string',
          pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$',
        },
        doc_type: { enum: ['INVOICE', 'CREDIT_MEMO'] },
        row_count: {
          type: 'integer',
          minimum: 1,
          maximum: 2147483647,
        },
        net: { $ref: '#/$defs/amount' },
        vat: { $ref: '#/$defs/amount' },
        gross: { $ref: '#/$defs/amount' },
      },
    },
  },
} as const;

export const MIGRATION_MANIFEST_SCHEMA_V11 = {
  ...MIGRATION_MANIFEST_SCHEMA_V10,
  title: 'ACP canonical migration manifest v1.1',
  required: [
    'format_version',
    'source_name',
    'source_system',
    'source_company_code',
    'extracted_at',
    'cutover_date',
    'currency',
    'files',
    'control_totals',
    'assets',
  ],
  properties: {
    ...MIGRATION_MANIFEST_SCHEMA_V10.properties,
    format_version: { const: '1.1' },
    assets: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'sha256', 'size_bytes', 'media_type', 'created_via'],
        properties: {
          name: {
            type: 'string',
            pattern: '^asset_[A-Za-z0-9_-]{1,128}\\.pdf$',
          },
          sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
          size_bytes: {
            type: 'integer',
            minimum: 1,
            maximum: 52428800,
          },
          media_type: { const: 'application/pdf' },
          created_via: {
            enum: ['ORIGINAL_EXPORT', 'SOURCE_MASS_PRINT'],
          },
        },
      },
    },
    control_totals: {
      type: 'object',
      additionalProperties: false,
      required: [
        'counts_by_type',
        'stock_value',
        'open_items',
        'document_totals',
        'domain_counts',
        'open_orders_net',
        'open_items_as_of',
      ],
      properties: {
        counts_by_type: { $ref: '#/$defs/countsByType' },
        stock_value: {
          oneOf: [{ type: 'null' }, { $ref: '#/$defs/amount' }],
        },
        open_items: {
          oneOf: [{ type: 'null' }, { $ref: '#/$defs/signedAmount' }],
        },
        document_totals: {
          type: 'array',
          items: { $ref: '#/$defs/documentTotal' },
        },
        domain_counts: {
          type: 'object',
          additionalProperties: false,
          required: [
            'vehicle_parties',
            'vehicle_due_dates',
            'vehicle_notices',
            'tyre_sets',
            'open_orders',
            'open_order_lines',
            'legacy_documents',
            'open_items',
          ],
          properties: {
            vehicle_parties: { $ref: '#/$defs/vehiclePartiesCounts' },
            vehicle_due_dates: { $ref: '#/$defs/vehicleDueDatesCounts' },
            vehicle_notices: { $ref: '#/$defs/vehicleNoticesCounts' },
            tyre_sets: { $ref: '#/$defs/tyreSetsCounts' },
            open_orders: { $ref: '#/$defs/openOrdersCounts' },
            open_order_lines: { $ref: '#/$defs/openOrderLinesCounts' },
            legacy_documents: { $ref: '#/$defs/legacyDocumentsCounts' },
            open_items: { $ref: '#/$defs/openItemsCounts' },
          },
        },
        open_orders_net: {
          oneOf: [{ type: 'null' }, { $ref: '#/$defs/amount' }],
        },
        open_items_as_of: {
          oneOf: [{ type: 'null' }, { type: 'string', format: 'date' }],
        },
      },
    },
  },
  $defs: {
    ...MIGRATION_MANIFEST_SCHEMA_V10.$defs,
    vehiclePartiesCounts: domainEnumCountSchema([
      'OWNER',
      'DRIVER',
      'USER',
      'BILL_TO',
      'LEASING',
      'INSURANCE',
      'WARRANTY_PROVIDER',
      'SERVICE_CONTRACT',
      'PREVIOUS_OWNER',
    ]),
    vehicleDueDatesCounts: domainEnumCountSchema([
      'INSPECTION_57A',
      'SERVICE',
    ]),
    vehicleNoticesCounts: domainEnumCountSchema([
      'CAMPAIGN',
      'RECALL',
      'REMARK',
      'WARNING',
      'SERVICE_DUE',
    ]),
    tyreSetsCounts: domainEnumCountSchema([
      'IN_STORAGE',
      'ON_VEHICLE',
      'RETURNED',
      'DISPOSED',
    ]),
    openOrdersCounts: domainEnumCountSchema(['ORDER', 'QUOTE', 'SCHEDULED']),
    openOrderLinesCounts: domainEnumCountSchema([
      'LABOR',
      'PART',
      'FEE',
      'TEXT',
    ]),
    legacyDocumentsCounts: domainEnumCountSchema([
      'INVOICE',
      'CREDIT_MEMO',
      'SERVICE_ORDER',
      'QUOTE',
      'WARRANTY_CLAIM',
      'SERVICE_CONTRACT',
      'TYRE_ORDER',
      'VEHICLE_HISTORY_SUMMARY',
    ]),
    openItemsCounts: domainEnumCountSchema([
      'INVOICE',
      'CREDIT_MEMO',
      'PAYMENT',
      'REFUND',
      'REMINDER_FEE',
    ]),
  },
} as const;

function domainEnumCountSchema(keys: string[]) {
  const properties = Object.fromEntries(
    keys.map((key) => [
      key,
      {
        type: 'integer',
        minimum: 0,
        maximum: 2147483647,
      },
    ]),
  );
  return {
    oneOf: [
      { type: 'null' },
      {
        type: 'object',
        additionalProperties: false,
        required: keys,
        properties,
      },
    ],
  };
}
