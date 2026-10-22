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
    {
      key: 'first_registration_date',
      label_de: 'Erstzulassung',
      required: false,
    },
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
    'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Erstzulassung;Kilometerstand;Farbe;Kunden-Nr;Schlüsselnummer',
};

const LABOR_OPERATION_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.LABOR_OPERATION,
  fields: [
    { key: 'external_id', label_de: 'Arbeitswert-Nr', required: true },
    { key: 'code', label_de: 'AW-Code', required: true },
    { key: 'description', label_de: 'Beschreibung', required: true },
    { key: 'standard_aw', label_de: 'AW', required: true },
    { key: 'hourly_rate', label_de: 'Stundensatz', required: true },
    { key: 'internal_cost', label_de: 'Interner Kostensatz', required: false },
    { key: 'category_name', label_de: 'Kategorie', required: false },
    { key: 'fitment_make', label_de: 'Marke', required: false },
    { key: 'fitment_model', label_de: 'Modell', required: false },
    { key: 'fitment_year_from', label_de: 'Baujahr von', required: false },
    { key: 'fitment_year_to', label_de: 'Baujahr bis', required: false },
    { key: 'fitment_engine_code', label_de: 'Motorcode', required: false },
  ],
  csv_header:
    'Arbeitswert-Nr;AW-Code;Beschreibung;AW;Stundensatz;Interner Kostensatz;Kategorie;Marke;Modell;Baujahr von;Baujahr bis;Motorcode',
};

const VEHICLE_PARTY_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.VEHICLE_PARTY,
  fields: [
    { key: 'external_id', label_de: 'Beteiligten-Nr', required: true },
    { key: 'vehicle_external_id', label_de: 'Fahrzeug-Nr', required: true },
    { key: 'customer_external_id', label_de: 'Kunden-Nr', required: true },
    { key: 'role', label_de: 'Rolle', required: true },
    { key: 'valid_from', label_de: 'Gültig ab', required: false },
    { key: 'valid_to', label_de: 'Gültig bis', required: false },
    { key: 'notes', label_de: 'Notizen', required: false },
  ],
  csv_header:
    'external_id;vehicle_external_id;customer_external_id;role;valid_from;valid_to;notes',
};

const VEHICLE_DUE_DATE_TEMPLATE: ImportTemplateDefinition = {
  entity_type: ImportEntityType.VEHICLE_DUE_DATE,
  fields: [
    { key: 'external_id', label_de: 'Fälligkeits-Nr', required: true },
    { key: 'vehicle_external_id', label_de: 'Fahrzeug-Nr', required: true },
    { key: 'kind', label_de: 'Art', required: true },
    { key: 'inspected_on', label_de: 'Begutachtet am', required: false },
    {
      key: 'plaketten_valid_until_year',
      label_de: 'Plakette gültig bis (Jahr)',
      required: false,
    },
    {
      key: 'plaketten_valid_until_month',
      label_de: 'Plakette gültig bis (Monat)',
      required: false,
    },
    { key: 'due_date', label_de: 'Fällig am', required: false },
    { key: 'due_mileage', label_de: 'Fällig bei km', required: false },
    { key: 'external_ref', label_de: 'Referenz', required: false },
    { key: 'station_name', label_de: 'Prüfstelle', required: false },
    { key: 'notes', label_de: 'Notizen', required: false },
  ],
  csv_header:
    'external_id;vehicle_external_id;kind;inspected_on;plaketten_valid_until_year;plaketten_valid_until_month;due_date;due_mileage;external_ref;station_name;notes',
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
  if (entityType === ImportEntityType.LABOR_OPERATION) {
    return LABOR_OPERATION_TEMPLATE;
  }
  if (entityType === ImportEntityType.VEHICLE_PARTY) {
    return VEHICLE_PARTY_TEMPLATE;
  }
  if (entityType === ImportEntityType.VEHICLE_DUE_DATE) {
    return VEHICLE_DUE_DATE_TEMPLATE;
  }
  throw new Error('Unsupported import entity type');
}

export function buildTemplateCsv(entityType: ImportEntityType): string {
  const template = getImportTemplate(entityType);
  const headers = template.csv_header.split(';');
  return serializeCsv(headers, [], ';');
}
