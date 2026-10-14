import { Logger } from '@nestjs/common';
import { NotificationRecipientKind } from '@prisma/client';
import {
  type RefusedRecipient,
  customerIdOf,
  withdrawConfirmationAfterRefusal,
} from './notification-email-confirmation.js';

const REFUSED: RefusedRecipient = {
  tenantId: 'tenant-1',
  outboxId: 'outbox-1',
  recipientKind: NotificationRecipientKind.CUSTOMER,
  recipientEmail: 'max.muster@example.at',
  payload: { customer_id: 'customer-1' },
};

function makePrisma(
  stored: { email: string | null } | null,
  updateError?: Error,
) {
  return {
    customer: {
      findFirst: jest.fn().mockResolvedValue(stored),
      updateMany: updateError
        ? jest.fn().mockRejectedValue(updateError)
        : jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('withdrawConfirmationAfterRefusal (ADR-0025 §8)', () => {
  it('clears the confirmation while the stored address is still the refused one', async () => {
    const prisma = makePrisma({ email: 'max.muster@example.at' });

    await withdrawConfirmationAfterRefusal(prisma as never, REFUSED);

    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: { id: 'customer-1', tenant_id: 'tenant-1' },
      select: { email: true },
    });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'customer-1',
        tenant_id: 'tenant-1',
        email: 'max.muster@example.at',
      },
      data: { contact_email_ok: false },
    });
  });

  it('clears it when the stored address only differs by surrounding spaces', async () => {
    const prisma = makePrisma({ email: '  max.muster@example.at ' });

    await withdrawConfirmationAfterRefusal(prisma as never, REFUSED);

    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'customer-1',
        tenant_id: 'tenant-1',
        email: '  max.muster@example.at ',
      },
      data: { contact_email_ok: false },
    });
  });

  it('keeps the confirmation when the customer has since given another address', async () => {
    const prisma = makePrisma({ email: 'neu@example.at' });

    await withdrawConfirmationAfterRefusal(prisma as never, REFUSED);

    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing when the customer is gone or has no address', async () => {
    for (const stored of [null, { email: null }]) {
      const prisma = makePrisma(stored);

      await withdrawConfirmationAfterRefusal(prisma as never, REFUSED);

      expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    }
  });

  it('reads nothing for a recipient that is not a customer or a payload without one', async () => {
    const prisma = makePrisma({ email: 'max.muster@example.at' });

    await withdrawConfirmationAfterRefusal(prisma as never, {
      ...REFUSED,
      recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
    });
    await withdrawConfirmationAfterRefusal(prisma as never, {
      ...REFUSED,
      payload: { order_id: 'order-1' },
    });

    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('logs a failed update and does not throw, because the row outcome is already recorded', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const prisma = makePrisma(
      { email: 'max.muster@example.at' },
      new Error('connection reset'),
    );

    await expect(
      withdrawConfirmationAfterRefusal(prisma as never, REFUSED),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('outbox-1'));
    warn.mockRestore();
  });
});

describe('customerIdOf', () => {
  it('reads the customer id only from an object payload', () => {
    expect(customerIdOf({ customer_id: 'customer-1' })).toBe('customer-1');
    expect(customerIdOf(['customer-1'])).toBeNull();
    expect(customerIdOf({ customer_id: 7 })).toBeNull();
    expect(customerIdOf(null)).toBeNull();
  });
});
