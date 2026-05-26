import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Request, Response } from 'express';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { TenantContextStorage } from './tenant-context.storage';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildRequest(
  overrides: Partial<{
    'x-request-id': string;
    'x-forwarded-for': string;
    'user-agent': string;
    ip: string;
  }> = {},
): Request {
  const {
    'x-request-id': reqId,
    'x-forwarded-for': forwarded,
    'user-agent': ua,
    ip,
  } = overrides;

  return {
    headers: {
      ...(reqId !== undefined ? { 'x-request-id': reqId } : {}),
      ...(forwarded !== undefined ? { 'x-forwarded-for': forwarded } : {}),
      ...(ua !== undefined ? { 'user-agent': ua } : {}),
    },
    ip: ip ?? '127.0.0.1',
  } as unknown as Request;
}

function buildResponse(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest
      .fn<(name: string, value: string) => void>()
      .mockImplementation((name: string, value: string) => {
        headers[name] = value;
      }),
  } as unknown as Response;
  return { res, headers };
}

describe('TenantContextMiddleware', () => {
  let middleware: TenantContextMiddleware;

  beforeEach(() => {
    middleware = new TenantContextMiddleware();
  });

  // ── Request ID propagation ─────────────────────────────────────────────────

  describe('request ID propagation', () => {
    it('reuses an inbound x-request-id header value', (done) => {
      const req = buildRequest({ 'x-request-id': 'client-req-id-abc' });
      const { res, headers } = buildResponse();

      middleware.use(req, res, () => {
        const meta = TenantContextStorage.getRequestMeta();
        expect(meta?.requestId).toBe('client-req-id-abc');
        expect(headers['x-request-id']).toBe('client-req-id-abc');
        done();
      });
    });

    it('generates a UUID when x-request-id header is absent', (done) => {
      const req = buildRequest();
      const { res, headers } = buildResponse();

      middleware.use(req, res, () => {
        const meta = TenantContextStorage.getRequestMeta();
        expect(meta?.requestId).toMatch(UUID_REGEX);
        expect(headers['x-request-id']).toMatch(UUID_REGEX);
        done();
      });
    });

    it('generates distinct IDs for concurrent requests', (done) => {
      let id1: string | undefined;
      let id2: string | undefined;
      let completed = 0;

      const check = () => {
        if (++completed === 2) {
          expect(id1).toBeDefined();
          expect(id2).toBeDefined();
          expect(id1).not.toBe(id2);
          done();
        }
      };

      middleware.use(buildRequest(), buildResponse().res, () => {
        id1 = TenantContextStorage.getRequestMeta()?.requestId;
        check();
      });

      middleware.use(buildRequest(), buildResponse().res, () => {
        id2 = TenantContextStorage.getRequestMeta()?.requestId;
        check();
      });
    });
  });

  // ── Source ─────────────────────────────────────────────────────────────────

  describe('source', () => {
    it('sets source to API for HTTP requests', (done) => {
      middleware.use(buildRequest(), buildResponse().res, () => {
        expect(TenantContextStorage.getRequestMeta()?.source).toBe('API');
        done();
      });
    });
  });

  // ── IP extraction ──────────────────────────────────────────────────────────

  describe('IP extraction', () => {
    it('uses the leftmost value from x-forwarded-for', (done) => {
      const req = buildRequest({
        'x-forwarded-for': '203.0.113.5, 10.0.0.1, 10.0.0.2',
      });

      middleware.use(req, buildResponse().res, () => {
        expect(TenantContextStorage.getRequestMeta()?.ip).toBe('203.0.113.5');
        done();
      });
    });

    it('falls back to req.ip when x-forwarded-for is absent', (done) => {
      const req = buildRequest({ ip: '10.20.30.40' });

      middleware.use(req, buildResponse().res, () => {
        expect(TenantContextStorage.getRequestMeta()?.ip).toBe('10.20.30.40');
        done();
      });
    });
  });

  // ── User-Agent ─────────────────────────────────────────────────────────────

  describe('user-agent', () => {
    it('captures the user-agent header', (done) => {
      const req = buildRequest({ 'user-agent': 'MyClient/1.0' });

      middleware.use(req, buildResponse().res, () => {
        expect(TenantContextStorage.getRequestMeta()?.userAgent).toBe(
          'MyClient/1.0',
        );
        done();
      });
    });

    it('stores undefined when user-agent is absent', (done) => {
      const req = buildRequest();

      middleware.use(req, buildResponse().res, () => {
        expect(TenantContextStorage.getRequestMeta()?.userAgent).toBeUndefined();
        done();
      });
    });
  });

  // ── Context isolation ──────────────────────────────────────────────────────

  describe('ALS isolation', () => {
    it('keeps request metadata isolated between separate requests', (done) => {
      let metaA: ReturnType<(typeof TenantContextStorage)['getRequestMeta']>;
      let metaB: ReturnType<(typeof TenantContextStorage)['getRequestMeta']>;
      let finished = 0;

      const finish = () => {
        if (++finished === 2) {
          expect(metaA?.requestId).not.toBe(metaB?.requestId);
          expect(metaA?.ip).toBe('1.1.1.1');
          expect(metaB?.ip).toBe('2.2.2.2');
          done();
        }
      };

      middleware.use(buildRequest({ ip: '1.1.1.1' }), buildResponse().res, () => {
        metaA = TenantContextStorage.getRequestMeta();
        finish();
      });

      middleware.use(buildRequest({ ip: '2.2.2.2' }), buildResponse().res, () => {
        metaB = TenantContextStorage.getRequestMeta();
        finish();
      });
    });
  });
});
