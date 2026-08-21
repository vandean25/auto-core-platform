import { resolveCorsOrigins } from './cors-origins';

describe('resolveCorsOrigins', () => {
  it('splits, trims, and removes empty configured origins', () => {
    expect(
      resolveCorsOrigins(
        ' https://app.example.com, ,http://localhost:5173 ',
        'test',
      ),
    ).toEqual(['https://app.example.com', 'http://localhost:5173']);
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
