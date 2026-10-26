import { readBearerTokenFromAuthorizationHeader } from './read-bearer-authorization.js';

describe('readBearerTokenFromAuthorizationHeader', () => {
  it('accepts a bearer token with mixed-case scheme', () => {
    expect(
      readBearerTokenFromAuthorizationHeader('BeArEr signed.jwt.token'),
    ).toBe('signed.jwt.token');
  });

  it('rejects missing, empty, and non-bearer headers', () => {
    expect(readBearerTokenFromAuthorizationHeader(undefined)).toBeUndefined();
    expect(readBearerTokenFromAuthorizationHeader('')).toBeUndefined();
    expect(readBearerTokenFromAuthorizationHeader('Basic abc')).toBeUndefined();
    expect(readBearerTokenFromAuthorizationHeader('Bearer')).toBeUndefined();
    expect(readBearerTokenFromAuthorizationHeader('Bearer   ')).toBeUndefined();
  });

  it('rejects tokens with internal whitespace', () => {
    expect(
      readBearerTokenFromAuthorizationHeader('Bearer two parts'),
    ).toBeUndefined();
    expect(
      readBearerTokenFromAuthorizationHeader('Bearer token\ttrail'),
    ).toBeUndefined();
  });
});
