import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import type { SystemPrismaService } from '../prisma/system-prisma.service.js';
import type { PublicRateLimitStore } from './public-rate-limit.store.js';
import type { TurnstileVerifier } from './turnstile.verifier.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import type { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import type { LandingDemoSignInGrantService } from './landing-demo-sign-in-grant.service.js';

const getUserByEmail = jest.fn<(email: string) => Promise<unknown>>();
const getFirebaseAdminAuth = jest.fn(() => ({ getUserByEmail }));

jest.unstable_mockModule('../auth/firebase-admin.js', () => ({
  getFirebaseAdminAuth: () => getFirebaseAdminAuth(),
}));

const { LandingDemoAccessService } = await import(
  './landing-demo-access.service.js'
);

describe('LandingDemoAccessService account isolation', () => {
  const createAccessRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const tenantFindFirst = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const userFindFirst = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const transaction =
    jest.fn<(callback: (tx: unknown) => unknown) => Promise<unknown>>();

  const demoGrants = {
    userHasNonDemoActiveMembership: jest.fn(),
    assertDemoSignInGrantForSession: jest.fn(),
  } as unknown as LandingDemoSignInGrantService;

  const rateLimits = {
    consume: jest
      .fn<PublicRateLimitStore['consume']>()
      .mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  } as unknown as PublicRateLimitStore;

  const turnstile = {
    verify: jest.fn<TurnstileVerifier['verify']>().mockResolvedValue(true),
  } as unknown as TurnstileVerifier;

  const outbox = {
    enqueueInTx: jest.fn(),
  } as unknown as NotificationOutboxService;

  const notificationWakeUps = {
    enqueueWakeUp: jest
      .fn<NotificationCloudTasksService['enqueueWakeUp']>()
      .mockResolvedValue(undefined),
  } as unknown as NotificationCloudTasksService;

  let service: InstanceType<typeof LandingDemoAccessService>;

  beforeEach(() => {
    jest.clearAllMocks();
    getUserByEmail.mockRejectedValue(new Error('not found'));
    process.env.LANDING_DEMO_ACCESS_ENABLED = 'true';
    process.env.LANDING_DEMO_SIGN_IN_CONTINUE_URL = 'https://app.example/login';
    process.env.LANDING_DEMO_OPERATOR_EMAIL = 'ops@example.com';
    process.env.LANDING_DEMO_TENANT_SLUG = 'selbstservice-demo';

    tenantFindFirst.mockResolvedValue({ id: 'tenant-demo', name: 'Demo' });
    createAccessRequest.mockResolvedValue({
      id: 'req-1',
      name: 'Maria',
      betrieb: 'Werkstatt',
      email: 'maria@example.com',
      telefon: null,
      nachricht: null,
    });
    transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback({}),
    );

    const systemPrisma = {
      tenant: { findFirst: tenantFindFirst },
      user: { findFirst: userFindFirst },
      landingDemoAccessRequest: { create: createAccessRequest },
      $transaction: transaction,
    } as unknown as SystemPrismaService;

    demoGrants.userHasNonDemoActiveMembership = jest
      .fn<LandingDemoSignInGrantService['userHasNonDemoActiveMembership']>()
      .mockResolvedValue(true);

    outbox.enqueueInTx = jest
      .fn<NotificationOutboxService['enqueueInTx']>()
      .mockResolvedValue({ blocked: false, created: true, id: 'o1' });

    service = new LandingDemoAccessService(
      systemPrisma,
      rateLimits,
      turnstile,
      outbox,
      notificationWakeUps,
      demoGrants,
    );
  });

  it('returns ok without provisioning when the email already has non-demo memberships', async () => {
    userFindFirst.mockResolvedValue({ id: 'user-1' });

    const result = await service.submit(
      {
        name: 'Maria',
        betrieb: 'Werkstatt',
        email: 'maria@example.com',
        consent: true,
      },
      { ip: '127.0.0.1' },
    );

    expect(result).toEqual({ ok: true });
    expect(createAccessRequest).toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(demoGrants.userHasNonDemoActiveMembership).toHaveBeenCalledWith(
      'user-1',
    );
  });
});
