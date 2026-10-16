import deEnums from '../../../../../../locales/de/enums.json'
import enEnums from '../../../../../../locales/en/enums.json'
import { formatImportFieldLabel } from '@/lib/i18n/enum-labels'
import { importFieldSegmentForEntity, type ImportEntityTypeUi } from '@/lib/i18n/enum-registry'

export type { ImportEntityTypeUi }

export type ImportFieldDefinition = {
  key: string
  required: boolean
  headerAliases?: string[]
}

export const CUSTOMER_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'external_id',
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
    required: false,
    headerAliases: ['typ', 'type', 'customer type', 'kundentyp'],
  },
  {
    key: 'company_name',
    required: false,
    headerAliases: ['firmenname', 'company', 'company name', 'firma'],
  },
  {
    key: 'first_name',
    required: false,
    headerAliases: ['vorname', 'first name', 'firstname', 'given name'],
  },
  {
    key: 'last_name',
    required: false,
    headerAliases: ['nachname', 'last name', 'lastname', 'surname', 'family name'],
  },
  {
    key: 'email',
    required: false,
    headerAliases: ['e-mail', 'email', 'mail'],
  },
  {
    key: 'phone',
    required: false,
    headerAliases: ['telefon', 'phone', 'tel', 'mobile', 'handy'],
  },
  {
    key: 'vat_id',
    required: false,
    headerAliases: ['uid', 'vat', 'vat id', 'vat_id', 'ust-id', 'ust id', 'tax id'],
  },
  {
    key: 'address_street',
    required: false,
    headerAliases: ['straße', 'strasse', 'street', 'address', 'adresse'],
  },
  {
    key: 'address_zip',
    required: false,
    headerAliases: ['plz', 'zip', 'postal code', 'postcode'],
  },
  {
    key: 'address_city',
    required: false,
    headerAliases: ['ort', 'city', 'town'],
  },
  {
    key: 'address_country',
    required: false,
    headerAliases: ['land', 'country', 'country code'],
  },
]

export const VEHICLE_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'external_id',
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
    required: false,
    headerAliases: ['fin', 'vin', 'fahrgestellnummer'],
  },
  {
    key: 'plate',
    required: false,
    headerAliases: ['kennzeichen', 'plate', 'license plate', 'registration'],
  },
  {
    key: 'make',
    required: true,
    headerAliases: ['marke', 'make', 'manufacturer', 'hersteller'],
  },
  {
    key: 'model',
    required: true,
    headerAliases: ['modell', 'model'],
  },
  {
    key: 'year',
    required: true,
    headerAliases: ['baujahr', 'year', 'model year', 'bj'],
  },
  {
    key: 'mileage',
    required: false,
    headerAliases: ['kilometerstand', 'mileage', 'km', 'odometer'],
  },
  {
    key: 'color',
    required: false,
    headerAliases: ['farbe', 'color', 'colour'],
  },
  {
    key: 'owner_customer_external_id',
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
    required: false,
    headerAliases: ['schlüsselnummer', 'schluesselnummer', 'key number', 'key no'],
  },
]

export const SUPPLIER_PRICE_LIST_IMPORT_FIELDS: ImportFieldDefinition[] = [
  {
    key: 'supplier_article_no',
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
    required: false,
    headerAliases: ['ean', 'barcode', 'gtin', 'ean-code', 'ean code'],
  },
  {
    key: 'description',
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
    required: false,
    headerAliases: ['markenname', 'marke', 'brand', 'hersteller', 'manufacturer'],
  },
  {
    key: 'cost_price',
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

export function formatFieldLabel(entityType: ImportEntityTypeUi, field: ImportFieldDefinition): string {
  return formatImportFieldLabel(entityType, field.key)
}

/** DE/EN labels used to match CSV headers during import mapping suggestions. */
export function importFieldHeaderLabelCandidates(
  entityType: ImportEntityTypeUi,
  fieldKey: string,
): string[] {
  const segment = importFieldSegmentForEntity(entityType)
  const deFields = deEnums.importField[segment] as Record<string, string>
  const enFields = enEnums.importField[segment] as Record<string, string>
  return [deFields[fieldKey], enFields[fieldKey]]
}

/** @deprecated Bilingual UI copy outside the import field enum maps; migrate callers to `t()`. */
export function bilingualLabel(english: string, german: string): string {
  return `${english} / ${german}`
}
