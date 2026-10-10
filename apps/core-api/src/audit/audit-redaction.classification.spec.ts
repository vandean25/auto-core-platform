import { classifyPiiFieldName } from './audit-redaction.util.js';

/**
 * Pins which field names count as email, phone or address data for audit output. The table is the
 * contract: a refactor of the classifier must keep every row, including the id-suffix exception and
 * the near misses that must stay unclassified.
 */
describe('classifyPiiFieldName characterization', () => {
  it.each([
    ['email', 'email'],
    ['Email', 'email'],
    ['customer_email', 'email'],
    ['E-Mail', 'email'],
    ['EMAIL_ADDRESS', 'email'],
    ['emailAddress', 'email'],
    ['mail', 'email'],
  ])('classifies %s as %s', (fieldName, kind) => {
    expect(classifyPiiFieldName(fieldName)).toBe(kind);
  });

  it.each([
    ['phone', 'phone'],
    ['phone_number', 'phone'],
    ['telephone', 'phone'],
    ['telefon', 'phone'],
    ['mobil', 'phone'],
    ['mobile', 'phone'],
    ['fax', 'phone'],
    ['telefax', 'phone'],
    ['tel', 'phone'],
    ['handy', 'phone'],
  ])('classifies %s as %s', (fieldName, kind) => {
    expect(classifyPiiFieldName(fieldName)).toBe(kind);
  });

  it.each([
    ['address', 'address'],
    ['billing_address', 'address'],
    ['adresse', 'address'],
    ['street', 'address'],
    ['strasse', 'address'],
    ['Straße', 'address'],
    ['city', 'address'],
    ['ort', 'address'],
    ['plz', 'address'],
    ['zip', 'address'],
    ['zipcode', 'address'],
    ['postcode', 'address'],
    ['postal_code', 'address'],
    ['house_number', 'address'],
    ['hausnummer', 'address'],
    ['hausnr', 'address'],
  ])('classifies %s as %s', (fieldName, kind) => {
    expect(classifyPiiFieldName(fieldName)).toBe(kind);
  });

  it.each([
    'address_id',
    'addressId',
    'customer_id',
    'mail_id',
    'city_id',
    'paid',
    'name',
    'first_name',
    'notes',
    'ort_name',
    'contact',
  ])('leaves %s unclassified', (fieldName) => {
    expect(classifyPiiFieldName(fieldName)).toBeNull();
  });
});
