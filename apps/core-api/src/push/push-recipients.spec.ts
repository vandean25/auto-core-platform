import { NotificationEventType } from '@prisma/client';
import { resolvePushRecipients } from './push-recipients.js';

function setup(options: {
  optedIn?: string[];
  employees?: Array<string | null>;
  members?: string[];
}) {
  const tx = {
    pushPreference: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (options.optedIn ?? []).map((user_id) => ({ user_id })),
        ),
    },
    employee: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (options.employees ?? []).map((user_id) => ({ user_id })),
        ),
    },
    siteMembership: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          (options.members ?? []).map((user_id) => ({ user_id })),
        ),
    },
  };
  return tx;
}

const query = {
  tenantId: 'tenant-1',
  siteId: 'site-1',
  eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
};

describe('resolvePushRecipients', () => {
  it('stops at the first query when nobody switched the event on', async () => {
    const tx = setup({});

    await expect(resolvePushRecipients(tx as never, query)).resolves.toEqual(
      [],
    );

    expect(tx.pushPreference.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        enabled_events: {
          has: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
        },
      },
      select: { user_id: true },
    });
    expect(tx.employee.findMany).not.toHaveBeenCalled();
    expect(tx.siteMembership.findMany).not.toHaveBeenCalled();
  });

  it('takes the active advisors and the extra employees among those who opted in', async () => {
    const tx = setup({
      optedIn: ['u1', 'u2'],
      employees: ['u1', 'u2'],
      members: ['u1', 'u2'],
    });

    await resolvePushRecipients(tx as never, {
      ...query,
      extraEmployeeIds: ['mechanic-1'],
    });

    expect(tx.employee.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        is_active: true,
        user_id: { in: ['u1', 'u2'] },
        OR: [{ role: 'SERVICE_ADVISOR' }, { id: { in: ['mechanic-1'] } }],
      },
      select: { user_id: true },
    });
  });

  it('keeps only active members of the tenant and of the site of the order, without duplicates', async () => {
    const tx = setup({
      optedIn: ['u1', 'u2', 'u3'],
      employees: ['u1', 'u2', 'u3', null],
      members: ['u1', 'u1', 'u3'],
    });

    await expect(resolvePushRecipients(tx as never, query)).resolves.toEqual([
      'u1',
      'u3',
    ]);

    expect(tx.siteMembership.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        site_id: 'site-1',
        is_active: true,
        user_id: { in: ['u1', 'u2', 'u3'] },
        tenantMember: { is_active: true },
      },
      select: { user_id: true },
    });
  });

  it('does not look at memberships when no opted-in user is an employee', async () => {
    const tx = setup({ optedIn: ['u1'], employees: [null] });

    await expect(resolvePushRecipients(tx as never, query)).resolves.toEqual(
      [],
    );
    expect(tx.siteMembership.findMany).not.toHaveBeenCalled();
  });
});
