import { Injectable } from '@nestjs/common';
import { DryRunStorage } from '../dry-run/dry-run.storage.js';
import {
  buildDomainEventRow,
  type AppendDomainEventInput,
  type DomainEventTxClient,
} from './domain-event.rows.js';

export type AppendedDomainEvent = {
  eventId: string;
  sequence: bigint;
};

type BoundExecuteRaw = (
  query: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

function boundExecuteRaw(tx: DomainEventTxClient): BoundExecuteRaw {
  return tx['$executeRaw'].bind(tx) as BoundExecuteRaw;
}

@Injectable()
export class DomainEventStoreService {
  /**
   * Appends one domain event inside the caller's transaction. Skipped during dry-run preview
   * so no row is written when the transaction rolls back (AUT-536).
   */
  async appendInTx(
    tx: DomainEventTxClient,
    input: AppendDomainEventInput,
  ): Promise<AppendedDomainEvent | null> {
    if (DryRunStorage.isDryRun()) {
      return null;
    }
    const lockKey = `domain_events:${input.tenantId}`;
    await boundExecuteRaw(
      tx,
    )`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}::text, 0))`;
    const row = buildDomainEventRow(input);
    const created = await tx.domainEvent.create({
      data: row,
      select: { id: true, sequence: true },
    });
    return { eventId: created.id, sequence: created.sequence };
  }
}
