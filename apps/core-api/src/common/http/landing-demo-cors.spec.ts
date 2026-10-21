import type { Request, Response } from 'express';
import { configureHttpCors } from './landing-demo-cors.js';

function createMockApp() {
  const handlers: Array<
    (req: Request, res: Response, next: () => void) => void
  > = [];
  return {
    use(handler: (req: Request, res: Response, next: () => void) => void) {
      handlers.push(handler);
    },
    handlers,
  };
}

function createMockResponse() {
  const headers: Record<string, string | string[]> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    getHeader(name: string) {
      return headers[name.toLowerCase()];
    },
    end() {},
  } as Response;
  return Object.assign(res, { headers });
}

describe('configureHttpCors', () => {
  it('applies credentialed dashboard CORS outside the landing demo route', async () => {
    const app = createMockApp();
    configureHttpCors(app as never, {
      dashboardOrigins: ['https://app.example.com'],
      landingPageOrigins: ['https://landing-demo.web.app'],
    });

    const req = {
      method: 'GET',
      originalUrl: '/api/customers',
      url: '/api/customers',
      headers: { origin: 'https://app.example.com' },
    } as Request;

    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handlers[0](req, res, resolve);
    });

    expect(res.headers['access-control-allow-origin']).toBe(
      'https://app.example.com',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('applies non-credentialed landing CORS only on the public demo route', async () => {
    const app = createMockApp();
    configureHttpCors(app as never, {
      dashboardOrigins: ['https://app.example.com'],
      landingPageOrigins: ['https://landing-demo.web.app'],
    });

    const req = {
      method: 'POST',
      originalUrl: '/api/public/landing-demo/access',
      url: '/api/public/landing-demo/access',
      headers: { origin: 'https://landing-demo.web.app' },
    } as Request;

    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handlers[0](req, res, resolve);
    });

    expect(res.headers['access-control-allow-origin']).toBe(
      'https://landing-demo.web.app',
    );
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('does not apply landing CORS to other API routes', async () => {
    const app = createMockApp();
    configureHttpCors(app as never, {
      dashboardOrigins: ['https://app.example.com'],
      landingPageOrigins: ['https://landing-demo.web.app'],
    });

    const req = {
      method: 'POST',
      originalUrl: '/api/customers',
      url: '/api/customers',
      headers: { origin: 'https://landing-demo.web.app' },
    } as Request;

    const res = createMockResponse();

    await new Promise<void>((resolve) => {
      app.handlers[0](req, res, resolve);
    });

    expect(res.headers['access-control-allow-origin']).not.toBe(
      'https://landing-demo.web.app',
    );
  });
});
