export function customerLabel(customer: {
  company_name: string | null;
  first_name: string;
  last_name: string;
}): string {
  return (
    customer.company_name?.trim() ||
    `${customer.first_name} ${customer.last_name}`.trim()
  );
}

export function joinParts(
  parts: ReadonlyArray<string | null | undefined>,
): string | null {
  const present = parts.filter((part): part is string => Boolean(part));
  return present.length > 0 ? present.join(' · ') : null;
}
