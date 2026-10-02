export type ImportEntityTypeUi = 'CUSTOMER' | 'VEHICLE'

export type ImportFieldDefinition = {
  key: string
  labelDe: string
  labelEn: string
  required: boolean
  headerAliases?: string[]
}

export const CUSTOMER_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'external_id',
    labelDe: 'Kunden-Nr',
    labelEn: 'Customer number',
    required: true,
    headerAliases: ['kundennr', 'customer no', 'customer number', 'customer_id', 'external id'],
  },
  {
    key: 'type',
    labelDe: 'Typ',
    labelEn: 'Type',
    required: false,
    headerAliases: ['customer type', 'kundentyp'],
  },
  { key: 'company_name', labelDe: 'Firmenname', labelEn: 'Company name', required: false },
  { key: 'first_name', labelDe: 'Vorname', labelEn: 'First name', required: false },
  { key: 'last_name', labelDe: 'Nachname', labelEn: 'Last name', required: false },
  { key: 'email', labelDe: 'E-Mail', labelEn: 'Email', required: false },
  { key: 'phone', labelDe: 'Telefon', labelEn: 'Phone', required: false },
  { key: 'vat_id', labelDe: 'UID', labelEn: 'VAT ID', required: false },
  { key: 'address_street', labelDe: 'Straße', labelEn: 'Street', required: false },
  { key: 'address_zip', labelDe: 'PLZ', labelEn: 'Postal code', required: false },
  { key: 'address_city', labelDe: 'Ort', labelEn: 'City', required: false },
  { key: 'address_country', labelDe: 'Land', labelEn: 'Country', required: false },
]

export const VEHICLE_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'external_id',
    labelDe: 'Fahrzeug-Nr',
    labelEn: 'Vehicle number',
    required: true,
    headerAliases: ['fahrzeugnr', 'vehicle no', 'vehicle number', 'vehicle_id', 'external id'],
  },
  { key: 'vin', labelDe: 'FIN', labelEn: 'VIN', required: false },
  { key: 'plate', labelDe: 'Kennzeichen', labelEn: 'License plate', required: false },
  { key: 'make', labelDe: 'Marke', labelEn: 'Make', required: true },
  { key: 'model', labelDe: 'Modell', labelEn: 'Model', required: true },
  { key: 'year', labelDe: 'Baujahr', labelEn: 'Year', required: true },
  { key: 'mileage', labelDe: 'Kilometerstand', labelEn: 'Mileage', required: false },
  { key: 'color', labelDe: 'Farbe', labelEn: 'Color', required: false },
  {
    key: 'owner_customer_external_id',
    labelDe: 'Kunden-Nr',
    labelEn: 'Owner customer number',
    required: false,
    headerAliases: ['customer no', 'owner', 'owner id', 'owner_customer', 'kundennr'],
  },
  { key: 'key_number', labelDe: 'Schlüsselnummer', labelEn: 'Key number', required: false },
]

export function getImportFieldsForEntity(entityType: ImportEntityTypeUi): ImportFieldDefinition[] {
  return entityType === 'VEHICLE' ? VEHICLE_IMPORT_FIELDS : CUSTOMER_IMPORT_FIELDS
}

export function formatFieldLabel(field: ImportFieldDefinition): string {
  return `${field.labelDe} / ${field.labelEn}`
}

export function bilingualLabel(english: string, german: string): string {
  return `${english} / ${german}`
}
