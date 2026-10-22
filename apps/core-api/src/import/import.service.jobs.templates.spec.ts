/** ImportService getTemplate characterization (split for repowise; AUT-602). */
import { ImportEntityType } from '@prisma/client';
import {
  ACTOR_AUTH_UID,
  setupImportHarness,
} from './import.service.spec.support.js';

describe('ImportService getTemplate (characterization)', () => {
  const h = setupImportHarness();

  describe('getTemplate', () => {
    it.each([
      [
        ImportEntityType.CUSTOMER,
        'Kunden-Nr;Typ;Firmenname;Vorname;Nachname;E-Mail;Telefon;UID;Straße;PLZ;Ort;Land\n',
        12,
      ],
      [
        ImportEntityType.VEHICLE,
        'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Erstzulassung;Kilometerstand;Farbe;Kunden-Nr;Schlüsselnummer\n',
        11,
      ],
      [
        ImportEntityType.SUPPLIER_PRICE_LIST,
        'Lieferanten-Artikelnummer;EAN;Beschreibung;Marke;Einkaufspreis;UVP;Einheit\n',
        7,
      ],
      [
        ImportEntityType.LABOR_OPERATION,
        'Arbeitswert-Nr;AW-Code;Beschreibung;AW;Stundensatz;Interner Kostensatz;Kategorie;Marke;Modell;Baujahr von;Baujahr bis;Motorcode\n',
        12,
      ],
      [
        ImportEntityType.VEHICLE_PARTY,
        'external_id;vehicle_external_id;customer_external_id;role;valid_from;valid_to;notes\n',
        7,
      ],
      [
        ImportEntityType.VEHICLE_DUE_DATE,
        'external_id;vehicle_external_id;kind;inspected_on;plaketten_valid_until_year;plaketten_valid_until_month;due_date;due_mileage;external_ref;station_name;notes\n',
        11,
      ],
    ])(
      'returns the %s template header, fields and CSV',
      (entityType, csv, fieldCount) => {
        const template = h.service.getTemplate(entityType);

        expect(template.entity_type).toBe(entityType);
        expect(template.fields).toHaveLength(fieldCount);
        expect(template.csv).toBe(csv);
      },
    );

    it('rejects non-admin callers', () => {
      h.tenantContext.getAuthenticatedUser.mockReturnValue({
        userId: ACTOR_AUTH_UID,
        role: 'TECH',
      });

      expect(() => h.service.getTemplate(ImportEntityType.CUSTOMER)).toThrow(
        'Tenant admin access is required.',
      );
    });
  });
});
