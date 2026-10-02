export function pickCustomerAuditSnapshot(customer: {
  type: string;
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
}): Record<string, unknown> {
  return {
    type: customer.type,
    company_name: customer.company_name,
    first_name: customer.first_name,
    last_name: customer.last_name,
    email: customer.email,
    phone: customer.phone,
    vat_id: customer.vat_id,
    address_street: customer.address_street,
    address_zip: customer.address_zip,
    address_city: customer.address_city,
    address_country: customer.address_country,
  };
}

export function buildImportAuditDiff(
  before: unknown,
  after: unknown,
): Record<string, { before: unknown; after: unknown }> | null {
  if (!before || !after) {
    return null;
  }
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const key of Object.keys(afterRecord)) {
    if (beforeRecord[key] !== afterRecord[key]) {
      diff[key] = { before: beforeRecord[key], after: afterRecord[key] };
    }
  }
  return Object.keys(diff).length > 0 ? diff : null;
}
