import type { PrismaService } from '../prisma/prisma.service.js';
import { CustomerSearchProvider } from './providers/customer-search.provider.js';
import { InvoiceSearchProvider } from './providers/invoice-search.provider.js';
import { PartSearchProvider } from './providers/part-search.provider.js';
import { StockVehicleSearchProvider } from './providers/stock-vehicle-search.provider.js';
import { VehicleSearchProvider } from './providers/vehicle-search.provider.js';
import { WorkshopOrderSearchProvider } from './providers/workshop-order-search.provider.js';
import type { SearchProvider } from './search.types.js';

/** Registry order is the group order of the response. */
export function createSearchProviders(prisma: PrismaService): SearchProvider[] {
  return [
    new CustomerSearchProvider(prisma),
    new VehicleSearchProvider(prisma),
    new StockVehicleSearchProvider(prisma),
    new WorkshopOrderSearchProvider(prisma),
    new InvoiceSearchProvider(prisma),
    new PartSearchProvider(prisma),
  ];
}
