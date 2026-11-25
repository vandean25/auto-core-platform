import type { DomainEvent, Prisma } from '@prisma/client';
import { getSharedRuntimePool } from '../prisma/shared-pg-pool.js';

export const DOMAIN_EVENT_QUERY_POOL = Symbol('DOMAIN_EVENT_QUERY_POOL');

export type DomainEventQueryPool = {
  query<T extends Record<string, unknown>>(
    sql: string,
    values: unknown[],
  ): Promise<{ rows: T[] }>;
};

export type VisibleDomainEventsQuery = {
  tenantId: string;
  siteIds?: readonly string[];
  eventType?: string;
  afterSequence?: bigint;
  afterCursor?: { sequence: bigint; id: string };
  limit: number;
};

type RawDomainEventRow = {
  id: string;
  sequence: string | bigint;
  event_type: string;
  schema_version: number;
  tenant_id: string;
  site_id: string;
  entity_id: string;
  occurred_at: Date | string;
  trace_id: string;
  occurrence_key: string;
  payload: Prisma.JsonValue | null;
};

/**
 * Queries `domain_events` with `tx_xid < pg_snapshot_xmin(pg_current_snapshot())`
 * so readers never observe or advance cursors past uncommitted out-of-order transactions (AUT-1052).
 */
export async function queryVisibleDomainEvents(
  query: VisibleDomainEventsQuery,
  pool: DomainEventQueryPool = getSharedRuntimePool(),
): Promise<DomainEvent[]> {
  if (query.siteIds && query.siteIds.length === 0) {
    return [];
  }

  const values: unknown[] = [query.tenantId];
  const conditions: string[] = [
    '"tenant_id" = $1',
    '"tx_xid" < pg_snapshot_xmin(pg_current_snapshot())',
  ];

  if (query.siteIds) {
    values.push([...query.siteIds]);
    conditions.push(`"site_id" = ANY($${values.length}::text[])`);
  }

  if (query.eventType) {
    values.push(query.eventType);
    conditions.push(`"event_type" = $${values.length}`);
  }

  if (query.afterCursor) {
    values.push(query.afterCursor.sequence.toString());
    const seqParam = `$${values.length}::bigint`;
    values.push(query.afterCursor.id);
    const idParam = `$${values.length}`;
    conditions.push(
      `("sequence" > ${seqParam} OR ("sequence" = ${seqParam} AND "id" > ${idParam}))`,
    );
  } else if (query.afterSequence !== undefined) {
    values.push(query.afterSequence.toString());
    conditions.push(`"sequence" > $${values.length}::bigint`);
  }

  values.push(Math.max(1, Math.floor(query.limit)));
  const limitParam = `$${values.length}::int`;

  const sql = `
    SELECT
      "id",
      "sequence",
      "event_type",
      "schema_version",
      "tenant_id",
      "site_id",
      "entity_id",
      "occurred_at",
      "trace_id"::text AS "trace_id",
      "occurrence_key",
      "payload"
    FROM "domain_events"
    WHERE ${conditions.join(' AND ')}
    ORDER BY "sequence" ASC, "id" ASC
    LIMIT ${limitParam}
  `;

  const result = await pool.query<RawDomainEventRow>(sql, values);
  return result.rows.map((row) => ({
    ...row,
    sequence:
      typeof row.sequence === 'bigint' ? row.sequence : BigInt(row.sequence),
    occurred_at:
      row.occurred_at instanceof Date
        ? row.occurred_at
        : new Date(row.occurred_at),
  }));
}
