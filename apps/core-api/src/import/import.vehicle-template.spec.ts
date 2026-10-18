import { ImportEntityType } from '@prisma/client';
import { getImportTemplate } from './import.templates.js';

describe('vehicle import template (Erstzulassung)', () => {
  it('includes Erstzulassung in CSV header and field list', () => {
    const template = getImportTemplate(ImportEntityType.VEHICLE);

    expect(template.fields).toHaveLength(11);
    expect(template.fields.some((f) => f.key === 'first_registration_date')).toBe(
      true,
    );
    expect(template.csv_header).toBe(
      'Fahrzeug-Nr;FIN;Kennzeichen;Marke;Modell;Baujahr;Erstzulassung;Kilometerstand;Farbe;Kunden-Nr;Schlüsselnummer',
    );
  });
});
