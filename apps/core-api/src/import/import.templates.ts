import { ImportEntityType } from '@prisma/client';
import type { ImportTemplateDefinition } from './import.types.js';
import { serializeCsv } from './csv-parse.util.js';

const CUSTOMER_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.CUSTOMER,
  fields: [
    { key: 'external_id', label_de: 'Kunden-Nr', required: true },
    { key: 'type', label_de: 'Typ', required: false },
    { key: 'company_name', label_de: 'Firmenname', required: false },
    { key: 'first_name', label_de: 'Vorname', required: false },
    { key: 'last_name', label_de: 'Nachname', required: false },
    { key: 'email', label_de: 'E-Mail', required: false },
    { key: 'phone', label_de: 'Telefon', required: false },
    { key: 'vat_id', label_de: 'UID', required: false },
    { key: 'address_street', label_de: 'Straße', required: false },
    { key: 'address_zip', label_de: 'PLZ', required: false },
    { key: 'address_city', label_de: 'Ort', required: false },
    { key: 'address_country', label_de: 'Land', required: false },
  ],
  csv_header:
    'Kunden-Nr;Typ;Firmenname;Vorname;Nachname;E-Mail;Telefon;UID;Straße;PLZ;Ort;Land',
};

const VEHICLE_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.VEHICLE,
  fields: [
    { key: 'external_id', label_de: 'Fahrzeug-Nr', required: true },
    { key: 'vin', label_de: 'FIN', required: false },
    { key: 'plate', label_de: 'Kennzeichen', required: false },
    { key: 'make', label_de: 'Marke', required: true },
    { key: 'model', label_de: 'Modell', required: true },
    { key: 'year', label_de: 'Baujahr', required: true },
    { key: 'mileage', label_de: 'Kilometerstand', required: false },
    { key: 'color', label_de: 'Farbe', required: false },
    {
      key: 'owner_customer_external_id',
      label_de: 'Kunden-Nr',
      required: false,
    },
    { key: 'key_number', label_de: 'Schlüsselnummer', required: false },
  ],
  csv_header:
    'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Kilometerstand;Farbe;Kunden-Nr;Schlüsselnummer',
};

const SUPPLIER_PRICE_LIST_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.SUPPLIER_PRICE_LIST,
  fields: [
    {
      key: 'supplier_article_no',
      label_de: 'Lieferanten-Artikelnummer',
      required: true,
    },
    { key: 'ean', label_de: 'EAN', required: false },
    { key: 'description', label_de: 'Beschreibung', required: true },
    { key: 'brand', label_de: 'Marke', required: false },
    { key: 'cost_price', label_de: 'Einkaufspreis', required: true },
    { key: 'rrp', label_de: 'UVP', required: false },
    { key: 'unit', label_de: 'Einheit', required: false },
  ],
  csv_header:
    'Lieferanten-Artikelnummer;EAN;Beschreibung;Marke;Einkaufspreis;UVP;Einheit',
};

export function getImportTemplate(
  entityType: ImportEntityType,
): ImportTemplateDefinition {
  if (entityType === ImportEntityType.CUSTOMER) {
    return CUSTOMER_TEMPLATE;
  }
  if (entityType === ImportEntityType.VEHICLE) {
    return VEHICLE_TEMPLATE;
  }
  if (entityType === ImportEntityType.SUPPLIER_PRICE_LIST) {
    return SUPPLIER_PRICE_LIST_TEMPLATE;
  }
  throw new Error('Unsupported import entity type');
}

export function buildTemplateCsv(entityType: ImportEntityType): string {
  const template = getImportTemplate(entityType);
  const headers = template.csv_header.split(';');
  return serializeCsv(headers, [], ';');
}
