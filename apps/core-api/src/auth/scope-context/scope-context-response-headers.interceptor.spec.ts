import { describe, expect, it } from '@jest/globals';
import { ScopeContextResponseHeadersInterceptor } from './scope-context-response-headers.interceptor.js';

describe('ScopeContextResponseHeadersInterceptor (AUT-937)', () => {
  it('sets Cache-Control private, no-store on HTTP responses', () => {
    const interceptor = new ScopeContextResponseHeadersInterceptor();
    const headers: Record<string, string> = {};
    const response = {
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    };
    const next = { handle: () => ({ pipe: () => undefined }) };

    interceptor.intercept(context as never, next as never);

    expect(headers['cache-control']).toBe('private, no-store');
  });
});
