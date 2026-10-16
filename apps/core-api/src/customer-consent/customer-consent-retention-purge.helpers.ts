import type { Prisma, PrismaClient } from '@prisma/client';

type PrismaLike = Pick<PrismaClient, 'customerConsent'>;

export async function purgeExpiredConsentProofRows(
  prisma: PrismaLike,
  tenantId: string,
  now: Date,
): Promise<number> {
  const heldChains = await prisma.customerConsent.groupBy({
    by: ['controller_legal_entity_id', 'customer_id', 'channel', 'purpose'],
    where: {
      tenant_id: tenantId,
      legal_hold: true,
    },
  });

  const chainFilters: Prisma.CustomerConsentWhereInput[] = heldChains.map(
    (chain) => ({
      controller_legal_entity_id: chain.controller_legal_entity_id,
      customer_id: chain.customer_id,
      channel: chain.channel,
      purpose: chain.purpose,
    }),
  );

  const result = await prisma.customerConsent.deleteMany({
    where: {
      tenant_id: tenantId,
      retain_until: { lt: now },
      legal_hold: false,
      ...(chainFilters.length > 0 ? { NOT: { OR: chainFilters } } : {}),
    },
  });
  return result.count;
}
