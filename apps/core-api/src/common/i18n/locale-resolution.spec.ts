import {
  resolveCustomerLanguage,
  resolveDocumentLanguage,
  resolveUserLanguage,
} from './locale-resolution.js';

describe('locale resolution', () => {
  it('resolves user language with tenant and de fallback', () => {
    expect(resolveUserLanguage('en', 'de')).toBe('en');
    expect(resolveUserLanguage(null, 'en')).toBe('en');
    expect(resolveUserLanguage(null, 'de')).toBe('de');
    expect(resolveUserLanguage(undefined, 'de')).toBe('de');
  });

  it('resolves customer language without user language', () => {
    expect(resolveCustomerLanguage('en', 'de')).toBe('en');
    expect(resolveCustomerLanguage(null, 'en')).toBe('en');
    expect(resolveCustomerLanguage(null, 'de')).toBe('de');
  });

  it('falls back document locale to de for legacy snapshots', () => {
    expect(resolveDocumentLanguage({})).toBe('de');
    expect(resolveDocumentLanguage({ document_locale: 'en' })).toBe('en');
  });
});
