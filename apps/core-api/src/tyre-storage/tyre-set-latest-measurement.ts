import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma/prisma.service.js';

export type TyreMeasurementWithWheels = Prisma.TyreMeasurementGetPayload<{
  include: { wheels: true };
}>;

type TyreMeasurementReader = Pick<PrismaService, 'tyreMeasurement'>;

/**
 * Latest measurement per tyre set in one batched read (two scoped queries),
 * ordered by capture time so backdated events cannot win and by creation
 * time for captures that share an occurrence timestamp.
 */
export async function loadLatestTyreMeasurements(
  prisma: TyreMeasurementReader,
  scope: { tenantId: string; siteId: string },
  tyreSetIds: string[],
): Promise<Map<string, TyreMeasurementWithWheels>> {
  const ids = [...new Set(tyreSetIds)];
  if (ids.length === 0) return new Map();

  const latest = await prisma.tyreMeasurement.groupBy({
    by: ['tyre_set_id'],
    where: {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      tyre_set_id: { in: ids },
    },
    _max: { measured_at: true },
  });
  const wanted = latest.flatMap((row) =>
    row.tyre_set_id && row._max.measured_at
      ? [{ tyre_set_id: row.tyre_set_id, measured_at: row._max.measured_at }]
      : [],
  );
  if (wanted.length === 0) return new Map();

  const rows = await prisma.tyreMeasurement.findMany({
    where: {
      tenant_id: scope.tenantId,
      site_id: scope.siteId,
      OR: wanted,
    },
    include: {
      wheels: {
        where: { tenant_id: scope.tenantId },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: [{ measured_at: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });

  const bySet = new Map<string, TyreMeasurementWithWheels>();
  for (const row of rows) {
    if (row.tyre_set_id && !bySet.has(row.tyre_set_id)) {
      bySet.set(row.tyre_set_id, row);
    }
  }
  return bySet;
}
