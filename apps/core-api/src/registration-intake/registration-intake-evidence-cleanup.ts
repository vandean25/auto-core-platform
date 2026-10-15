import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

export async function clearRegistrationEvidenceForCustomer(
  tx: Prisma.TransactionClient,
  tenantId: string,
  customerId: string,
): Promise<void> {
  const intakes = await tx.registrationDocumentIntake.findMany({
    where: { tenant_id: tenantId, applied_customer_id: customerId },
    select: { id: true, evidence: true },
  });
  for (const intake of intakes) {
    const evidence = intake.evidence as Record<string, unknown> | null;
    if (!evidence || typeof evidence !== 'object') continue;
    const fields = evidence.fields as Record<string, unknown> | undefined;
    const holder = fields?.holder as Record<string, unknown> | undefined;
    if (holder) {
      holder.raw = null;
    }
    await tx.registrationDocumentIntake.updateMany({
      where: { id: intake.id, tenant_id: tenantId },
      data: {
        evidence: evidence as PrismaTypes.InputJsonValue,
        match_snapshot: Prisma.JsonNull,
      },
    });
  }
}

export async function clearRegistrationEvidenceForVehicle(
  tx: Prisma.TransactionClient,
  tenantId: string,
  vehicleId: string,
): Promise<void> {
  const intakes = await tx.registrationDocumentIntake.findMany({
    where: { tenant_id: tenantId, applied_vehicle_id: vehicleId },
    select: { id: true, evidence: true },
  });
  for (const intake of intakes) {
    const evidence = intake.evidence as Record<string, unknown> | null;
    if (!evidence || typeof evidence !== 'object') continue;
    const fields = evidence.fields as Record<string, unknown> | undefined;
    const holder = fields?.holder as Record<string, unknown> | undefined;
    if (holder) {
      holder.raw = null;
    }
    await tx.registrationDocumentIntake.updateMany({
      where: { id: intake.id, tenant_id: tenantId },
      data: {
        evidence: evidence as PrismaTypes.InputJsonValue,
        match_snapshot: Prisma.JsonNull,
      },
    });
  }
}
