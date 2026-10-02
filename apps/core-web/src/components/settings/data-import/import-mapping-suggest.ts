import type { ImportFieldDefinition } from './import-field-labels'

const FIELD_HEADER_ALIASES: Record<string, string[]> = {
  external_id: [
    'kunden-nr',
    'kundennr',
    'customer no',
    'customer number',
    'customer_id',
    'fahrzeug-nr',
    'fahrzeugnr',
    'vehicle no',
    'vehicle number',
    'vehicle_id',
    'external id',
    'external_id',
  ],
  type: ['typ', 'type', 'customer type', 'kundentyp'],
  company_name: ['firmenname', 'company', 'company name', 'firma'],
  first_name: ['vorname', 'first name', 'firstname', 'given name'],
  last_name: ['nachname', 'last name', 'lastname', 'surname', 'family name'],
  email: ['e-mail', 'email', 'mail'],
  phone: ['telefon', 'phone', 'tel', 'mobile', 'handy'],
  vat_id: ['uid', 'vat', 'vat id', 'vat_id', 'ust-id', 'ust id', 'tax id'],
  address_street: ['straße', 'strasse', 'street', 'address', 'adresse'],
  address_zip: ['plz', 'zip', 'postal code', 'postcode'],
  address_city: ['ort', 'city', 'town'],
  address_country: ['land', 'country', 'country code'],
  vin: ['fin', 'vin', 'fahrgestellnummer'],
  plate: ['kennzeichen', 'plate', 'license plate', 'registration'],
  make: ['marke', 'make', 'manufacturer', 'hersteller'],
  model: ['modell', 'model'],
  year: ['baujahr', 'year', 'model year', 'bj'],
  mileage: ['kilometerstand', 'mileage', 'km', 'odometer'],
  color: ['farbe', 'color', 'colour'],
  owner_customer_external_id: [
    'kunden-nr',
    'customer no',
    'owner',
    'owner id',
    'owner_customer',
  ],
  key_number: ['schlüsselnummer', 'schluesselnummer', 'key number', 'key no'],
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, ' ')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

function headerMatchesAlias(header: string, alias: string): boolean {
  const normalizedHeader = normalizeHeader(header)
  const normalizedAlias = normalizeHeader(alias)
  return (
    normalizedHeader === normalizedAlias ||
    normalizedHeader.replace(/\s/g, '') === normalizedAlias.replace(/\s/g, '')
  )
}

export function suggestColumnMapping(
  csvHeaders: string[],
  fields: ImportFieldDefinition[],
): Record<string, string> {
  const usedHeaders = new Set<string>()
  const mapping: Record<string, string> = {}

  for (const field of fields) {
    const aliases = [
      field.labelDe,
      field.labelEn,
      ...(FIELD_HEADER_ALIASES[field.key] ?? []),
    ]

    const match = csvHeaders.find((header) => {
      if (usedHeaders.has(header)) return false
      return aliases.some((alias) => headerMatchesAlias(header, alias))
    })

    if (match) {
      mapping[field.key] = match
      usedHeaders.add(match)
    }
  }

  return mapping
}

export function validateRequiredMappings(
  mapping: Record<string, string>,
  fields: ImportFieldDefinition[],
): string[] {
  const missing: string[] = []
  for (const field of fields) {
    if (!field.required) continue
    const column = mapping[field.key]?.trim()
    if (!column) {
      missing.push(field.key)
    }
  }
  return missing
}
