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
    const row = buildDomainEventRow(input);
    const created = await tx.domainEvent.create({
      data: row,
      select: { id: true, sequence: true },
    });
    return { eventId: created.id, sequence: created.sequence };
  }
}
