import type { PrismaService } from '../prisma/prisma.service.js';
import {
  activePartyWhere,
  OPEN_DUE_DATE_LIMIT,
  openServiceDueWhere,
} from '../vehicle/vehicle-party.query.js';
import { dateToDay, dayToDate } from '../vehicle/vehicle-party.writer.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';

type CustomerName = {
  company_name: string | null;
  first_name: string;
  last_name: string;
};

function customerName(customer: CustomerName): string {
  return (
    customer.company_name?.trim() ||
    `${customer.first_name} ${customer.last_name}`.trim()
  );
}

/** Active parties of a vehicle, tenant-wide. Read only. */
export async function loadMcpActiveParties(
  prisma: PrismaService,
  tenantId: string,
  vehicleId: string,
  asOf: Date,
) {
  const day = dayToDate(viennaIsoDay(asOf)) as Date;
  const rows = await prisma.vehicleParty.findMany({
    where: activePartyWhere(tenantId, vehicleId, day),
    orderBy: [{ role: 'asc' }, { id: 'asc' }],
    take: OPEN_DUE_DATE_LIMIT,
    select: {
      id: true,
      role: true,
      customer_id: true,
      valid_from: true,
      valid_to: true,
      source: true,
      customer: {
        select: { company_name: true, first_name: true, last_name: true },
      },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    customer_id: row.customer_id,
    customer_name: customerName(row.customer),
    valid_from: dateToDay(row.valid_from),
    valid_to: dateToDay(row.valid_to),
    source: row.source,
  }));
}

/** Open SERVICE_DUE notices of a vehicle. Read only; resolving them belongs to the notices work. */
export async function loadMcpOpenServiceDue(
  prisma: PrismaService,
  tenantId: string,
  vehicleId: string,
) {
  const where = openServiceDueWhere(tenantId, vehicleId);
  const [total, rows] = await Promise.all([
    prisma.vehicleNotice.count({ where }),
    prisma.vehicleNotice.findMany({
      where,
      orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
      take: OPEN_DUE_DATE_LIMIT,
      select: {
        id: true,
        title: true,
        due_date: true,
        due_mileage: true,
        external_ref: true,
        source: true,
      },
    }),
  ]);
  return {
    total,
    rows: rows.map((row) => ({
      id: row.id,
      title: row.title,
      due_date: dateToDay(row.due_date),
      due_mileage: row.due_mileage,
      external_ref: row.external_ref,
      source: row.source,
    })),
  };
}
