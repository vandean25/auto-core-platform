import {
  redactEventPaths,
  redactRequestPath,
} from './redact-request-path.js';

const TOKEN = 'A'.repeat(43);

describe('redactRequestPath', () => {
  it('replaces the approval token segment with a placeholder', () => {
    expect(
      redactRequestPath(`/api/public/estimate-approvals/${TOKEN}`),
    ).toBe('/api/public/estimate-approvals/:token');
  });

  it('redacts the token under any letter case of the route', () => {
    expect(
      redactRequestPath(`/API/Public/ESTIMATE-APPROVALS/${TOKEN}`),
    ).toBe('/API/Public/ESTIMATE-APPROVALS/:token');
  });

  it('redacts the token when the route is spelled with backslashes, or the target ends in a fragment', () => {
    expect(
      redactRequestPath(`http://h/api\\public\\estimate-approvals\\${TOKEN}`),
    ).toBe('http://h/api\\public\\estimate-approvals\\:token');
    expect(
      redactRequestPath(`/api/public/estimate-approvals/${TOKEN}#frag`),
    ).toBe('/api/public/estimate-approvals/:token#frag');
  });

  it('keeps the query string and leaves other paths alone', () => {
    expect(
      redactRequestPath(`/api/public/estimate-approvals/${TOKEN}?x=1`),
    ).toBe('/api/public/estimate-approvals/:token?x=1');
    expect(redactRequestPath('/api/workshop/estimates/1/send')).toBe(
      '/api/workshop/estimates/1/send',
    );
  });
});

describe('redactEventPaths', () => {
  it('redacts the token in nested strings and keeps the other fields', () => {
    const event = {
      request: { url: `https://api.example.at/api/public/estimate-approvals/${TOKEN}` },
      transaction: `GET /api/public/estimate-approvals/${TOKEN}`,
      breadcrumbs: [{ data: { url: `/api/public/estimate-approvals/${TOKEN}` } }],
      level: 'error',
    };

    const scrubbed = redactEventPaths(event);

    expect(JSON.stringify(scrubbed)).not.toContain(TOKEN);
    expect(scrubbed.request.url).toBe(
      'https://api.example.at/api/public/estimate-approvals/:token',
    );
    expect(scrubbed.level).toBe('error');
  });
});

describe('search text redaction', () => {
  it.each([
    ['/api/search?q=max%20mustermann', '/api/search?:redacted'],
    ['/api/search?types=customer&q=max@example.at', '/api/search?:redacted'],
    ['/api/search/?q=Name', '/api/search/?:redacted'],
    ['/api/search?q=Secret&q=b', '/api/search?:redacted'],
    ['/api/search?q=W-12345A#frag', '/api/search?:redacted#frag'],
  ])('hides the whole query of %s', (input, expected) => {
    expect(redactRequestPath(input)).toBe(expected);
  });

  it('leaves other paths alone', () => {
    expect(redactRequestPath('/api/customers?x=keep')).toBe(
      '/api/customers?x=keep',
    );
  });

  it('hides q in the query strings Sentry attaches to events', () => {
    const event = {
      request: { query_string: 'types=customer&q=Mustermann' },
      contexts: { trace: { data: { 'url.query': '?q=max@example.at&limit=5' } } },
      breadcrumbs: [{ data: { 'http.query': '?q=W-1' } }],
    };

    expect(JSON.stringify(redactEventPaths(event))).not.toMatch(
      /Mustermann|max@example|W-1/,
    );
    expect(redactEventPaths(event).request.query_string).toBe(
      'types=customer&q=:redacted',
    );
  });
});
