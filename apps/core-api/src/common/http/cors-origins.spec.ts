import { resolveCorsOrigins } from './cors-origins.js';
import { resolveLandingPageOrigins } from './landing-demo-cors.js';

describe('resolveCorsOrigins', () => {
  it('splits, trims, and removes empty configured origins', () => {
    expect(
      resolveCorsOrigins(
        ' https://app.example.com, ,http://localhost:5173 ',
        'test',
      ),
    ).toEqual(['https://app.example.com', 'http://localhost:5173']);
  });

  it('does not merge landing page origins into dashboard CORS', () => {
    process.env.LANDING_PAGE_ORIGINS = 'https://landing-demo.web.app';
    expect(resolveCorsOrigins('https://app.example.com', 'test')).toEqual([
      'https://app.example.com',
    ]);
  });

  it('uses local development origins outside production when unset', () => {
    expect(resolveCorsOrigins(undefined, 'development')).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]);
  });

  it('fails closed in production when no usable origin exists', () => {
    expect(() => resolveCorsOrigins(' , ', 'production')).toThrow(
      /without FRONTEND_URL/,
    );
  });
});

describe('resolveLandingPageOrigins', () => {
  it('parses landing origins separately for the public demo route', () => {
    expect(
      resolveLandingPageOrigins(
        'https://landing-demo.web.app, https://landing.example ',
      ),
    ).toEqual(['https://landing-demo.web.app', 'https://landing.example']);
  });
});
