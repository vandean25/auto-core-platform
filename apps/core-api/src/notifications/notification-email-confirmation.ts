import { Logger } from '@nestjs/common';
import { NotificationRecipientKind, type Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

const logger = new Logger('NotificationEmailConfirmation');

export interface RefusedRecipient {
  tenantId: string;
  outboxId: string;
  recipientKind: NotificationRecipientKind;
  recipientEmail: string | null;
  payload: Prisma.JsonValue | null;
}

/**
 * A permanent refusal of an address withdraws the advisor's email confirmation for that customer (ADR-0025 §8), so no
 * later estimate mail goes there until the advisor confirms it again. The customer is the one named in the row's
 * payload, and the stored address must still be the refused one, so a corrected address keeps its own confirmation.
 * Never throws: the row's outcome is already recorded, and a failed update is logged.
 */
export async function withdrawConfirmationAfterRefusal(
  prisma: PrismaService,
  refused: RefusedRecipient,
): Promise<void> {
  const customerId = customerIdOf(refused.payload);
  if (
    refused.recipientKind !== NotificationRecipientKind.CUSTOMER ||
    !customerId ||
    !refused.recipientEmail
  ) {
    return;
  }
  try {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, tenant_id: refused.tenantId },
      select: { email: true },
    });
    const storedEmail = customer?.email;
    // The send trims the address it writes to the row, so a stored address with surrounding spaces is the same mailbox.
    if (!storedEmail || storedEmail.trim() !== refused.recipientEmail.trim()) {
      return;
    }
    await prisma.customer.updateMany({
      where: {
        id: customerId,
        tenant_id: refused.tenantId,
        email: storedEmail,
      },
      data: { contact_email_ok: false },
    });
  } catch (cause) {
    logger.warn(
      `Could not clear the email confirmation after a refusal for notification ${refused.outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
    );
  }
}

/** The customer a customer message was written for, as the writer recorded it in the row's payload. */
export function customerIdOf(payload: Prisma.JsonValue | null): string | null {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    typeof payload.customer_id === 'string'
  ) {
    return payload.customer_id;
  }
  return null;
}
