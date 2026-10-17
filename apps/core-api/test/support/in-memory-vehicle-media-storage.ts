import type { VehicleMediaStorage } from '../../src/vehicle-stock/vehicle-media/vehicle-media.storage.js';

export class InMemoryVehicleMediaStorage implements VehicleMediaStorage {
  readonly objects = new Map<string, Buffer>();

  resolveBucket(): string {
    return 'in-memory-vehicle-media';
  }

  async readObject(params: { bucket: string; key: string }): Promise<Buffer> {
    const bytes = this.objects.get(params.key);
    if (!bytes) {
      throw new Error(`Missing in-memory object: ${params.key}`);
    }
    return Buffer.from(bytes);
  }

  objectPrefix(tenantId: string, vehicleId: string, mediaId: string): string {
    return `tenants/${tenantId}/vehicles/${vehicleId}/media/${mediaId}/`;
  }

  async storeProcessedObject(params: {
    tenantId: string;
    vehicleId: string;
    mediaId: string;
    variantName: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<string> {
    const objectKey = `${this.objectPrefix(
      params.tenantId,
      params.vehicleId,
      params.mediaId,
    )}${params.variantName}.jpg`;
    this.objects.set(objectKey, Buffer.from(params.bytes));
    return objectKey;
  }

  async deleteObjects(bucket: string, keys: string[]): Promise<void> {
    for (const key of keys) {
      this.objects.delete(key);
    }
  }

  async deleteVehicleMediaPrefix(params: {
    tenantId: string;
    vehicleId: string;
  }): Promise<void> {
    const prefix = `tenants/${params.tenantId}/vehicles/${params.vehicleId}/media/`;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix)) {
        this.objects.delete(key);
      }
    }
  }

  async deleteTenantVehicleMediaPrefix(tenantId: string): Promise<void> {
    const prefix = `tenants/${tenantId}/vehicles/`;
    for (const key of [...this.objects.keys()]) {
      if (key.startsWith(prefix) && key.includes('/media/')) {
        this.objects.delete(key);
      }
    }
  }
}
