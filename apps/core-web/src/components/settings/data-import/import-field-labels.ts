export type ImportEntityTypeUi = 'CUSTOMER' | 'VEHICLE' | 'SUPPLIER_PRICE_LIST'

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
    headerAliases: [
      'kunden-nr',
      'kundennr',
      'customer no',
      'customer number',
      'customer_id',
      'external id',
      'external_id',
    ],
  },
  {
    key: 'type',
    labelDe: 'Typ',
    labelEn: 'Type',
    required: false,
    headerAliases: ['typ', 'type', 'customer type', 'kundentyp'],
  },
  {
    key: 'company_name',
    labelDe: 'Firmenname',
    labelEn: 'Company name',
    required: false,
    headerAliases: ['firmenname', 'company', 'company name', 'firma'],
  },
  {
    key: 'first_name',
    labelDe: 'Vorname',
    labelEn: 'First name',
    required: false,
    headerAliases: ['vorname', 'first name', 'firstname', 'given name'],
  },
  {
    key: 'last_name',
    labelDe: 'Nachname',
    labelEn: 'Last name',
    required: false,
    headerAliases: ['nachname', 'last name', 'lastname', 'surname', 'family name'],
  },
  {
    key: 'email',
    labelDe: 'E-Mail',
    labelEn: 'Email',
    required: false,
    headerAliases: ['e-mail', 'email', 'mail'],
  },
  {
    key: 'phone',
    labelDe: 'Telefon',
    labelEn: 'Phone',
    required: false,
    headerAliases: ['telefon', 'phone', 'tel', 'mobile', 'handy'],
  },
  {
    key: 'vat_id',
    labelDe: 'UID',
    labelEn: 'VAT ID',
    required: false,
    headerAliases: ['uid', 'vat', 'vat id', 'vat_id', 'ust-id', 'ust id', 'tax id'],
  },
  {
    key: 'address_street',
    labelDe: 'Straße',
    labelEn: 'Street',
    required: false,
    headerAliases: ['straße', 'strasse', 'street', 'address', 'adresse'],
  },
  {
    key: 'address_zip',
    labelDe: 'PLZ',
    labelEn: 'Postal code',
    required: false,
    headerAliases: ['plz', 'zip', 'postal code', 'postcode'],
  },
  {
    key: 'address_city',
    labelDe: 'Ort',
    labelEn: 'City',
    required: false,
    headerAliases: ['ort', 'city', 'town'],
  },
  {
    key: 'address_country',
    labelDe: 'Land',
    labelEn: 'Country',
    required: false,
    headerAliases: ['land', 'country', 'country code'],
  },
]

export const VEHICLE_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'external_id',
    labelDe: 'Fahrzeug-Nr',
    labelEn: 'Vehicle number',
    required: true,
    headerAliases: [
      'fahrzeug-nr',
      'fahrzeugnr',
      'vehicle no',
      'vehicle number',
      'vehicle_id',
      'external id',
      'external_id',
    ],
  },
  {
    key: 'vin',
    labelDe: 'FIN',
    labelEn: 'VIN',
    required: false,
    headerAliases: ['fin', 'vin', 'fahrgestellnummer'],
  },
  {
    key: 'plate',
    labelDe: 'Kennzeichen',
    labelEn: 'License plate',
    required: false,
    headerAliases: ['kennzeichen', 'plate', 'license plate', 'registration'],
  },
  {
    key: 'make',
    labelDe: 'Marke',
    labelEn: 'Make',
    required: true,
    headerAliases: ['marke', 'make', 'manufacturer', 'hersteller'],
  },
  {
    key: 'model',
    labelDe: 'Modell',
    labelEn: 'Model',
    required: true,
    headerAliases: ['modell', 'model'],
  },
  {
    key: 'year',
    labelDe: 'Baujahr',
    labelEn: 'Year',
    required: true,
    headerAliases: ['baujahr', 'year', 'model year', 'bj'],
  },
  {
    key: 'mileage',
    labelDe: 'Kilometerstand',
    labelEn: 'Mileage',
    required: false,
    headerAliases: ['kilometerstand', 'mileage', 'km', 'odometer'],
  },
  {
    key: 'color',
    labelDe: 'Farbe',
    labelEn: 'Color',
    required: false,
    headerAliases: ['farbe', 'color', 'colour'],
  },
  {
    key: 'owner_customer_external_id',
    labelDe: 'Kunden-Nr',
    labelEn: 'Owner customer number',
    required: false,
    headerAliases: [
      'kunden-nr',
      'customer no',
      'owner',
      'owner id',
      'owner_customer',
      'kundennr',
    ],
  },
  {
    key: 'key_number',
    labelDe: 'Schlüsselnummer',
    labelEn: 'Key number',
    required: false,
    headerAliases: ['schlüsselnummer', 'schluesselnummer', 'key number', 'key no'],
  },
]

export const SUPPLIER_PRICE_LIST_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'supplier_article_no',
    labelDe: 'Lieferanten-Artikelnummer',
    labelEn: 'Supplier Article No.',
    required: true,
    headerAliases: [
      'lieferanten-artikelnummer',
      'lieferanten-artikelnr',
      'lieferantenartikelnr',
      'lieferantenartikelnummer',
      'artikelnummer',
      'artikelnr',
      'art-nr',
      'art.-nr.',
      'artikelnr.',
      'supplier article no',
      'supplier article no.',
      'supplier article number',
      'supplier_article_no',
      'part no',
      'part number',
      'item no',
      'item_no',
    ],
  },
  {
    key: 'ean',
    labelDe: 'EAN',
    labelEn: 'EAN',
    required: false,
    headerAliases: ['ean', 'barcode', 'gtin', 'ean-code', 'ean code'],
  },
  {
    key: 'description',
    labelDe: 'Artikelbezeichnung',
    labelEn: 'Description',
    required: true,
    headerAliases: [
      'artikelbezeichnung',
      'bezeichnung',
      'beschreibung',
      'description',
      'name',
      'artikelname',
      'part description',
    ],
  },
  {
    key: 'brand',
    labelDe: 'Markenname',
    labelEn: 'Brand',
    required: false,
    headerAliases: ['markenname', 'marke', 'brand', 'hersteller', 'manufacturer'],
  },
  {
    key: 'cost_price',
    labelDe: 'Einkaufspreis (netto)',
    labelEn: 'Cost Price',
    required: true,
    headerAliases: [
      'einkaufspreis (netto)',
      'einkaufspreis',
      'ek',
      'ek netto',
      'ek-preis',
      'ek preis',
      'cost',
      'cost price',
      'cost_price',
      'purchase price',
      'net cost',
    ],
  },
  {
    key: 'rrp',
    labelDe: 'UVP / RRP (brutto/netto)',
    labelEn: 'RRP',
    required: false,
    headerAliases: [
      'uvp / rrp (brutto/netto)',
      'uvp',
      'rrp',
      'uvp brutto',
      'uvp netto',
      'uvp-preis',
      'recommended retail price',
      'list price',
      'listenpreis',
    ],
  },
  {
    key: 'unit',
    labelDe: 'Einheit',
    labelEn: 'Unit',
    required: false,
    headerAliases: ['einheit', 'unit', 'vpe', 'uom', 'mengeneinheit'],
  },
]

export function getImportFieldsForEntity(entityType: ImportEntityTypeUi): ImportFieldDefinition[] {
  if (entityType === 'VEHICLE') {
    return VEHICLE_IMPORT_FIELDS
  }
  if (entityType === 'SUPPLIER_PRICE_LIST') {
    return SUPPLIER_PRICE_LIST_IMPORT_FIELDS
  }
  return CUSTOMER_IMPORT_FIELDS
}

export function formatFieldLabel(field: ImportFieldDefinition): string {
  return `${field.labelDe} / ${field.labelEn}`
}

export function bilingualLabel(english: string, german: string): string {
  return `${english} / ${german}`
}

