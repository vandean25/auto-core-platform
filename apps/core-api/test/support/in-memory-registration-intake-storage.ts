import type { RegistrationIntakeByteStorage } from '../../src/registration-intake/registration-intake-byte-storage.js';

export class InMemoryRegistrationIntakeByteStorage implements RegistrationIntakeByteStorage {
  readonly objects = new Map<string, Buffer>();
  deleteShouldFail = false;

  intakeObjectPrefix(tenantId: string, intakeId: string): string {
    return `registration-intakes/${tenantId}/${intakeId}/`;
  }

  private key(tenantId: string, intakeId: string, page: number): string {
    return `${this.intakeObjectPrefix(tenantId, intakeId)}page-${page}`;
  }

  async storePage(params: {
    tenantId: string;
    intakeId: string;
    page: number;
    bytes: Buffer;
    contentType: string;
  }): Promise<void> {
    this.objects.set(
      this.key(params.tenantId, params.intakeId, params.page),
      Buffer.from(params.bytes),
    );
  }

  async deleteIntakePrefix(params: {
    tenantId: string;
    intakeId: string;
  }): Promise<void> {
    if (this.deleteShouldFail) {
      throw new Error('simulated delete failure');
    }
    const prefix = this.intakeObjectPrefix(params.tenantId, params.intakeId);
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }

  async deleteTenantPrefix(tenantId: string): Promise<void> {
    if (this.deleteShouldFail) {
      throw new Error('simulated delete failure');
    }
    const prefix = `registration-intakes/${tenantId}/`;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }
}
