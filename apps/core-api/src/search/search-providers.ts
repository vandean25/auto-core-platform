import type { PrismaService } from '../prisma/prisma.service.js';
import { AppointmentSearchProvider } from './providers/appointment-search.provider.js';
import { CreditNoteSearchProvider } from './providers/credit-note-search.provider.js';
import { CustomerSearchProvider } from './providers/customer-search.provider.js';
import { EmployeeSearchProvider } from './providers/employee-search.provider.js';
import { EstimateSearchProvider } from './providers/estimate-search.provider.js';
import { InvoiceSearchProvider } from './providers/invoice-search.provider.js';
import { LaborOperationSearchProvider } from './providers/labor-operation-search.provider.js';
import { LegalEntitySearchProvider } from './providers/legal-entity-search.provider.js';
import { PartSearchProvider } from './providers/part-search.provider.js';
import { PurchaseInvoiceSearchProvider } from './providers/purchase-invoice-search.provider.js';
import { PurchaseOrderSearchProvider } from './providers/purchase-order-search.provider.js';
import { SalesOrderSearchProvider } from './providers/sales-order-search.provider.js';
import { SiteSearchProvider } from './providers/site-search.provider.js';
import { StockVehicleSearchProvider } from './providers/stock-vehicle-search.provider.js';
import { UserSearchProvider } from './providers/user-search.provider.js';
import { VehicleSaleSearchProvider } from './providers/vehicle-sale-search.provider.js';
import { VehicleSearchProvider } from './providers/vehicle-search.provider.js';
import { VendorSearchProvider } from './providers/vendor-search.provider.js';
import { WorkshopOrderSearchProvider } from './providers/workshop-order-search.provider.js';
import type { SearchProvider } from './search.types.js';

/** Registry order is the group order of the response. */
export function createSearchProviders(prisma: PrismaService): SearchProvider[] {
  return [
    new CustomerSearchProvider(prisma),
    new VehicleSearchProvider(prisma),
    new StockVehicleSearchProvider(prisma),
    new WorkshopOrderSearchProvider(prisma),
    new AppointmentSearchProvider(prisma),
    new EstimateSearchProvider(prisma),
    new SalesOrderSearchProvider(prisma),
    new VehicleSaleSearchProvider(prisma),
    new InvoiceSearchProvider(prisma),
    new CreditNoteSearchProvider(prisma),
    new PartSearchProvider(prisma),
    new LaborOperationSearchProvider(prisma),
    new VendorSearchProvider(prisma),
    new PurchaseOrderSearchProvider(prisma),
    new PurchaseInvoiceSearchProvider(prisma),
    new EmployeeSearchProvider(prisma),
    new UserSearchProvider(prisma),
    new LegalEntitySearchProvider(prisma),
    new SiteSearchProvider(prisma),
  ];
}
