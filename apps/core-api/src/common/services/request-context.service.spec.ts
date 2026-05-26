import { describe, it, expect, beforeEach } from '@jest/globals';
import { RequestContextService } from './request-context.service';
import { TenantContextStorage } from './tenant-context.storage';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = new RequestContextService();
  });

  // ── Read accessors outside any ALS context ──────────────────────────────────

  describe('getRequestId() outside context', () => {
    it('returns undefined when called outside an ALS context', () => {
      expect(service.getRequestId()).toBeUndefined();
    });
  });

  describe('getSource() outside context', () => {
    it('returns undefined when called outside an ALS context', () => {
      expect(service.getSource()).toBeUndefined();
    });
  });

  describe('getIp() / getUserAgent() outside context', () => {
    it('returns undefined for both when no context exists', () => {
      expect(service.getIp()).toBeUndefined();
      expect(service.getUserAgent()).toBeUndefined();
    });
  });

  // ── Request ID propagation ──────────────────────────────────────────────────

  describe('request ID propagation (set by middleware)', () => {
    it('returns the requestId that was stamped into the ALS context', () => {
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-abc-123',
          source: 'API',
        });

        expect(service.getRequestId()).toBe('req-abc-123');
      });
    });

    it('returns a different requestId in a separate ALS context', () => {
      let idA: string | undefined;
      let idB: string | undefined;

      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-aaa',
          source: 'API',
        });
        idA = service.getRequestId();
      });

      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-bbb',
          source: 'API',
        });
        idB = service.getRequestId();
      });

      expect(idA).toBe('req-aaa');
      expect(idB).toBe('req-bbb');
    });
  });

  // ── Authenticated actor visibility ─────────────────────────────────────────

  describe('authenticated actor data visibility', () => {
    it('exposes the source that was set for the current context', () => {
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-1',
          source: 'JOB',
        });

        expect(service.getSource()).toBe('JOB');
      });
    });

    it('exposes IP and user-agent stored by the middleware', () => {
      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'req-2',
          source: 'API',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        });

        expect(service.getIp()).toBe('192.168.1.1');
        expect(service.getUserAgent()).toBe('Mozilla/5.0');
      });
    });
  });

  // ── runAsWorker — non-HTTP context setup ────────────────────────────────────

  describe('runAsWorker()', () => {
    it('creates an ALS context with source JOB by default', () => {
      service.runAsWorker('tenant-1', () => {
        expect(service.getSource()).toBe('JOB');
      });
    });

    it('generates a UUID request ID for the worker context', () => {
      service.runAsWorker('tenant-1', () => {
        expect(service.getRequestId()).toMatch(UUID_REGEX);
      });
    });

    it('sets the authenticated user to cloud-tasks-worker by default', () => {
      service.runAsWorker('tenant-1', () => {
        const user = TenantContextStorage.getUser();
        expect(user?.userId).toBe('cloud-tasks-worker');
        expect(user?.tenantId).toBe('tenant-1');
        expect(user?.role).toBe('worker');
      });
    });

    it('accepts a custom workerId and email', () => {
      service.runAsWorker(
        'tenant-2',
        () => {
          const user = TenantContextStorage.getUser();
          expect(user?.userId).toBe('reconciler-job');
          expect(user?.email).toBe('job@system.internal');
        },
        { workerId: 'reconciler-job', email: 'job@system.internal' },
      );
    });

    it('accepts source SCRIPT for one-off maintenance scripts', () => {
      service.runAsWorker(
        'tenant-3',
        () => {
          expect(service.getSource()).toBe('SCRIPT');
        },
        { source: 'SCRIPT' },
      );
    });

    it('returns the value produced by the callback', () => {
      const result = service.runAsWorker('tenant-1', () => 42);
      expect(result).toBe(42);
    });

    it('is isolated from the surrounding execution context', () => {
      let innerRequestId: string | undefined;

      TenantContextStorage.run(() => {
        TenantContextStorage.setRequestMeta({
          requestId: 'outer-req',
          source: 'API',
        });

        service.runAsWorker('tenant-1', () => {
          innerRequestId = service.getRequestId();
        });

        // Outer context must not be mutated by runAsWorker.
        expect(service.getRequestId()).toBe('outer-req');
      });

      // The worker spawned a fresh request ID.
      expect(innerRequestId).not.toBe('outer-req');
      expect(innerRequestId).toMatch(UUID_REGEX);
    });

    it('each runAsWorker call generates a distinct request ID', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 5; i++) {
        service.runAsWorker('tenant-1', () => {
          const id = service.getRequestId();
          if (id) ids.add(id);
        });
      }

      expect(ids.size).toBe(5);
    });
  });
});
