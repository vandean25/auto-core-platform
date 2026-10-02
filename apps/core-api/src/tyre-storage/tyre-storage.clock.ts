import { Injectable } from '@nestjs/common';

@Injectable()
export class TyreStorageClock {
  private override: Date | null = null;

  now(): Date {
    return this.override ? new Date(this.override) : new Date();
  }

  /** Test-only: inject a fixed instant for due-list boundary tests. */
  setOverride(asOf: Date | null): void {
    this.override = asOf;
  }
}
