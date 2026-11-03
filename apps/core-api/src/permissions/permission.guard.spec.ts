import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, jest } from '@jest/globals';
import { InventoryController } from '../inventory/inventory.controller.js';
import { assertSiteReadAccess } from '../site/site.authorization.js';
import { PermissionGuard } from './permission.guard.js';
import { PermissionResolver } from './permission-resolver.js';

type Handler = (...args: never[]) => unknown;

/** A guard whose membership lookup answers `membership`, and a request to `controller.handler`. */
function setup(
  membership: object | null,
  target: { controller: object; handler: Handler },
  request: object = {},
) {
  const resolver = new PermissionResolver({
    tenantMember: {
      findFirst: jest
        .fn<(args: object) => Promise<object | null>>()
        .mockResolvedValue(membership),
    },
  } as never);
  const httpRequest = {
    user: { userId: 'firebase-uid-1', tenantId: 'tenant-1', role: 'SALES' },
    method: 'GET',
    path: '/api/inventory/x',
    ...request,
  };
  const context = {
    getClass: () => target.controller,
    getHandler: () => target.handler,
    switchToHttp: () => ({ getRequest: () => httpRequest }),
  } as unknown as ExecutionContext;
  return { guard: new PermissionGuard(resolver), context };
}

const sales = { role: 'SALES', demo_access_expires_at: null };
const findOne = {
  controller: InventoryController,
  handler: InventoryController.prototype.findOne as Handler,
};
const receiveStock = {
  controller: InventoryController,
  handler: InventoryController.prototype.receiveStock as Handler,
};

describe('permission guard', () => {
  // Scenario 4: fail closed.
  it('denies a route that has no operation mapping', async () => {
    class UnmappedController {
      unmapped() {
        return null;
      }
    }
    const { guard, context } = setup(sales, {
      controller: UnmappedController,
      handler: UnmappedController.prototype.unmapped,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  // Scenario 5: a granted permission is necessary, not sufficient.
  it('still refuses a document of a foreign site although the permission is granted (ADR-0022)', async () => {
    const { guard, context } = setup(sales, findOne);
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const siteMembership = jest
      .fn<(args: object) => Promise<object | null>>()
      .mockResolvedValue(null);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }) },
      tenantMember: { findFirst: jest.fn().mockResolvedValue({ id: 'm-1' }) },
      siteMembership: { findFirst: siteMembership },
    };
    const tenantContext = {
      getAuthenticatedUser: () => ({
        userId: 'firebase-uid-1',
        tenantId: 'tenant-1',
        role: 'SALES',
      }),
    };

    await expect(
      assertSiteReadAccess(
        prisma as never,
        tenantContext as never,
        'tenant-1',
        'foreign-site',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(siteMembership).toHaveBeenCalledWith({
      where: expect.objectContaining({
        tenant_id: 'tenant-1',
        site_id: 'foreign-site',
      }) as object,
      select: { id: true },
    });
  });

  it.each([
    ['SALES reads stock', sales, findOne, {}, true],
    ['SALES receives stock (ADMIN only)', sales, receiveStock, {}, false],
    [
      'a stale ADMIN claim while the database says SALES',
      sales,
      receiveStock,
      { user: { userId: 'firebase-uid-1', tenantId: 'tenant-1', role: 'ADMIN' } },
      false,
    ],
    [
      'a tenant API key on a member route',
      sales,
      findOne,
      {
        user: {
          userId: 'key-1',
          tenantId: 'tenant-1',
          role: 'API_KEY',
          apiKeyId: 'key-1',
        },
      },
      false,
    ],
    ['no active membership', null, findOne, {}, false],
  ])('%s', async (_label, membership, target, request, allowed) => {
    const { guard, context } = setup(membership, target, request);

    if (allowed) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    } else {
      await expect(guard.canActivate(context)).rejects.toThrow(
        ForbiddenException,
      );
    }
  });
});
