import type { ImportEntityType, ImportRowAction } from '@prisma/client';

export type ImportColumnMapping = Record<string, string>;

export type ImportJobOptions = {
  update_existing?: boolean;
  fill_empty_only?: boolean;
  allow_missing_vin?: boolean;
  invalid_vat_as_error?: boolean;
  create_new_catalog_items?: boolean;
  accept_all_price_jumps?: boolean;
  accepted_row_numbers?: number[];
  price_jump_threshold_percent?: number;
  vendor_id?: string;
};

export type ImportJobTotals = {
  rows: number;
  create: number;
  update: number;
  skip: number;
  error: number;
  flagged_jumps?: number;
};

export type ImportRowIssue = {
  code: string;
  message: string;
  field?: string;
};

export type NormalizedCustomerRow = {
  external_id: string;
  type: 'PRIVATE' | 'COMPANY';
  company_name: string | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  vat_id: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  address_country: string | null;
};

export type NormalizedVehicleRow = {
  external_id: string;
  vin: string | null;
  plate: string | null;
  make: string;
  model: string;
  year: number;
  mileage: number | null;
  color: string | null;
  owner_customer_external_id: string | null;
  owner_external_id_provided: boolean;
  key_number: string | null;
};

export type NormalizedSupplierPriceListRow = {
  supplier_article_no: string;
  ean: string | null;
  description: string;
  brand: string | null;
  cost_price: number;
  rrp: number | null;
  unit: string;
  calculated_retail_price?: number | null;
  price_jump_flagged?: boolean;
  cost_change_percent?: number | null;
  retail_change_percent?: number | null;
  old_cost_price?: number | null;
  old_retail_price?: number | null;
};

export type DryRunRowResult = {
  row_no: number;
  external_id: string | null;
  action: ImportRowAction;
  entity_id: string | null;
  errors: ImportRowIssue[];
  warnings: ImportRowIssue[];
  normalized: Record<string, unknown> | null;
};

export type ImportTemplateDefinition = {
  entity_type: ImportEntityType;
  fields: Array<{ key: string; label_de: string; required: boolean }>;
  csv_header: string;
};
