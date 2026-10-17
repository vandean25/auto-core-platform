import { randomUUID } from 'node:crypto';

/** Public listing ref: `L` + UUID without hyphens (marketplace-export spec). */
export function generateVehicleListingRef(): string {
  return `L${randomUUID().replaceAll('-', '')}`;
}
