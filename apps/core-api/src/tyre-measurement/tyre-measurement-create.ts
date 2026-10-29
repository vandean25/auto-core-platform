import type {
  Prisma,
  TyreMeasurement,
  TyreVehicleWeightClass,
  TyreWheelReading,
} from '@prisma/client';
import { captureTyreWheel } from './tyre-measurement-capture.js';
import type { CreateTyreWheelDto } from './tyre-measurement.dto.js';
import type { TyreEvaluationContext } from './tyre-evaluation.js';
import { validateTyreThresholdOverrides } from './tyre-thresholds.js';

export type TyreCaptureScope = Readonly<{ tenantId: string; siteId: string }>;

export type TyreMeasurementRowInput = {
  scope: TyreCaptureScope;
  vehicleId: string;
  wheels: CreateTyreWheelDto[];
  measuredAt: Date;
  workshopOrderId?: string | null;
  checkInId?: string | null;
  tyreSetId?: string | null;
  tyreSetEventId?: string | null;
  weightClass?: TyreVehicleWeightClass;
  actorId?: string | null;
  authorName?: string;
};

export type TyreMeasurementRow = TyreMeasurement & {
  wheels: TyreWheelReading[];
};

/** Persists one measurement with wheel snapshots inside an existing transaction. */
export async function createTyreMeasurementRow(
  tx: Prisma.TransactionClient,
  input: TyreMeasurementRowInput,
): Promise<TyreMeasurementRow> {
  const { scope } = input;
  const { authorName, evaluationContext } = await resolveCaptureContext(
    tx,
    input,
  );
  return tx.tyreMeasurement.create({
    data: {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      vehicle_id: input.vehicleId,
      workshop_order_id: input.workshopOrderId ?? null,
      check_in_id: input.checkInId ?? null,
      tyre_set_id: input.tyreSetId ?? null,
      tyre_set_event_id: input.tyreSetEventId ?? null,
      measured_at: input.measuredAt,
      measured_by: input.actorId ?? null,
      measured_by_name: authorName,
      country: evaluationContext.country,
      weight_class: evaluationContext.weightClass,
      weight_class_source: input.weightClass ? 'CAPTURE' : 'DEFAULT',
      wheels: {
        create: input.wheels.map((wheel) =>
          captureTyreWheel(wheel, evaluationContext),
        ),
      },
    },
    include: {
      wheels: {
        where: { tenant_id: scope.tenantId },
        orderBy: { position: 'asc' },
      },
    },
  });
}

async function resolveCaptureContext(
  tx: Prisma.TransactionClient,
  input: TyreMeasurementRowInput,
): Promise<{
  authorName: string;
  evaluationContext: TyreEvaluationContext;
}> {
  const { scope } = input;
  const [legalEntity, settings, user] = await Promise.all([
    tx.legalEntity.findFirstOrThrow({
      where: {
        tenant_id: scope.tenantId,
        sites: { some: { tenant_id: scope.tenantId, id: scope.siteId } },
      },
      select: { country_iso: true },
    }),
    tx.tyreStorageSettings.findFirst({
      where: { tenant_id: scope.tenantId },
    }),
    input.actorId
      ? tx.user.findUniqueOrThrow({
          where: { id: input.actorId },
          select: { firstName: true, lastName: true, email: true },
        })
      : null,
  ]);
  return {
    authorName: user
      ? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ||
        user.email
      : (input.authorName ?? 'Unknown'),
    evaluationContext: {
      country: legalEntity.country_iso,
      weightClass: input.weightClass ?? 'UP_TO_3500_KG',
      asOf: input.measuredAt,
      overrides: validateTyreThresholdOverrides(
        settings?.recommendation_overrides ?? {},
      ),
    },
  };
}
