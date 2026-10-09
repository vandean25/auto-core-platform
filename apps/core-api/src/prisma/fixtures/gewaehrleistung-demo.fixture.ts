import {
  CustomerType,
  InvoiceStatus,
  InvoiceTaxMode,
  VehicleInventoryRole,
  VehicleLedgerEntryType,
  VehiclePurchaseSellerType,
  VehiclePurchaseStatus,
  VehicleSaleStatus,
  VehicleStockStatus,
  VehicleTaxScheme,
  Prisma,
} from '@prisma/client';
import { computeGewaehrleistung } from '../../vehicle-stock/gewaehrleistung/compute-gewaehrleistung.js';
import { costBasis, marginVatGross } from '../../vehicle-stock/vehicle-cost.js';
import { daysInStock } from '../../vehicle-stock/vehicle-stock-reports.math.js';
import { InvoiceSnapshotCommitService } from '../../invoices/invoice-snapshot-commit.service.js';
import type { SiteContextService } from '../../site/site-context.service.js';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';
import {
  DEMO_GEWAHRLEISTUNG_CUSTOMER_EMAILS,
  DEMO_GEWAHRLEISTUNG_SALE_NUMBERS,
} from './gewaehrleistung-demo.constants.js';

type DemoSale = {
  saleNumber: string;
  vehicle: {
    make: string;
    model: string;
    year: number;
    vin: string;
    plate: string;
    firstRegistrationDate: Date;
  };
  customerId: string;
  contractConcludedAt: Date;
  handedOverAt: Date;
  buyerIsConsumer: boolean;
  shortenedNegotiated: boolean;
  salePrice: number;
  purchasePrice: number;
};

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function seedDemoGewaehrleistungSales(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  showroom: { id: string },
  vendor: { id: string },
  snapshotCommit = new InvoiceSnapshotCommitService({} as SiteContextService),
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const legalEntityId = foundation.defaultLegalEntity.id;
  const vendorId = vendor.id;
  const demoPrivateCustomers = await Promise.all(
    DEMO_GEWAHRLEISTUNG_CUSTOMER_EMAILS.slice(0, 2).map((email, index) =>
      prisma.customer.create({
        data: {
          tenant_id: tenantId,
          type: CustomerType.PRIVATE,
          first_name: 'Demo',
          last_name: index === 0 ? 'Gewaehrleistung 2Y' : 'Gewaehrleistung 1Y',
          email,
          address_street: `Demo Gewaehrleistung ${index + 1}`,
          address_zip: '1010',
          address_city: 'Vienna',
          address_country: 'AT',
        },
      }),
    ),
  );
  const b2bCustomer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      type: CustomerType.COMPANY,
      company_name: 'Demo Fuhrpark GmbH',
      first_name: 'Demo',
      last_name: 'Fuhrpark',
      email: DEMO_GEWAHRLEISTUNG_CUSTOMER_EMAILS[2],
      vat_id: 'ATU12345678',
      address_street: 'Demo Strasse 1',
      address_city: 'Vienna',
      address_zip: '1010',
      address_country: 'AT',
    },
  });

  const demoSales: DemoSale[] = [
    {
      saleNumber: DEMO_GEWAHRLEISTUNG_SALE_NUMBERS[0],
      vehicle: {
        make: 'Volkswagen',
        model: 'Golf Variant',
        year: 2019,
        vin: 'WARRANTYDEMO00001',
        plate: 'DEMO-GW-2Y',
        firstRegistrationDate: date('2021-09-10'),
      },
      customerId: demoPrivateCustomers[0].id,
      contractConcludedAt: date('2024-10-20'),
      handedOverAt: date('2024-10-25'),
      buyerIsConsumer: true,
      shortenedNegotiated: false,
      salePrice: 18_900,
      purchasePrice: 15_000,
    },
    {
      saleNumber: DEMO_GEWAHRLEISTUNG_SALE_NUMBERS[1],
      vehicle: {
        make: 'Audi',
        model: 'A4 Avant',
        year: 2021,
        vin: 'WARRANTYDEMO00002',
        plate: 'DEMO-GW-1Y',
        firstRegistrationDate: date('2023-09-10'),
      },
      customerId: demoPrivateCustomers[1].id,
      contractConcludedAt: date('2025-10-20'),
      handedOverAt: date('2025-10-25'),
      buyerIsConsumer: true,
      shortenedNegotiated: true,
      salePrice: 24_500,
      purchasePrice: 19_000,
    },
    {
      saleNumber: DEMO_GEWAHRLEISTUNG_SALE_NUMBERS[2],
      vehicle: {
        make: 'Skoda',
        model: 'Octavia Combi',
        year: 2022,
        vin: 'WARRANTYDEMO00003',
        plate: 'DEMO-GW-B2B',
        firstRegistrationDate: date('2022-06-15'),
      },
      customerId: b2bCustomer.id,
      contractConcludedAt: date('2026-10-01'),
      handedOverAt: date('2026-10-06'),
      buyerIsConsumer: false,
      shortenedNegotiated: false,
      salePrice: 27_900,
      purchasePrice: 21_000,
    },
  ];

  await Promise.all(
    demoSales.map(async (sale) => {
      const snapshot = computeGewaehrleistung({
        contractConcludedAt: sale.contractConcludedAt,
        handedOverAt: sale.handedOverAt,
        buyerIsConsumer: sale.buyerIsConsumer,
        shortenedNegotiated: sale.shortenedNegotiated,
        firstRegistrationDate: sale.vehicle.firstRegistrationDate,
      });
      if (snapshot.error) {
        throw new Error(
          `Invalid synthetic Gewaehrleistung sale ${sale.saleNumber}: ${snapshot.error.code}`,
        );
      }

      const purchaseDate = new Date(sale.handedOverAt);
      purchaseDate.setUTCDate(purchaseDate.getUTCDate() - 30);
      const basis = costBasis([
        {
          entry_type: VehicleLedgerEntryType.PURCHASE,
          amount: new Prisma.Decimal(sale.purchasePrice),
        },
      ]);
      const marginVat = marginVatGross(
        new Prisma.Decimal(sale.salePrice),
        basis,
        new Prisma.Decimal(20),
      );
      return prisma.$transaction(async (tx) => {
        const vehicle = await tx.vehicle.create({
          data: {
            tenant_id: tenantId,
            site_id: foundation.mainSite.id,
            location_id: showroom.id,
            inventory_role: VehicleInventoryRole.USED,
            stock_status: VehicleStockStatus.IN_STOCK,
            stock_received_at: purchaseDate,
            stock_cost_basis: basis,
            tax_scheme: VehicleTaxScheme.MARGIN,
            make: sale.vehicle.make,
            model: sale.vehicle.model,
            year: sale.vehicle.year,
            vin: sale.vehicle.vin,
            plate: sale.vehicle.plate,
            first_registration_date: sale.vehicle.firstRegistrationDate,
            purchases: {
              create: {
                tenant_id: tenantId,
                site_id: foundation.mainSite.id,
                purchase_number: `AUT408-GW-${sale.saleNumber}`,
                status: VehiclePurchaseStatus.RECEIVED,
                seller_type: VehiclePurchaseSellerType.VENDOR,
                vendor_id: vendorId,
                make: sale.vehicle.make,
                model: sale.vehicle.model,
                year: sale.vehicle.year,
                purchase_price: basis,
                location_id: showroom.id,
                received_at: purchaseDate,
              },
            },
            ledger_entries: {
              create: {
                tenant_id: tenantId,
                entry_type: VehicleLedgerEntryType.PURCHASE,
                amount: basis,
                posting_date: purchaseDate,
              },
            },
          },
        });
        const createdSale = await tx.vehicleSale.create({
          data: {
            tenant_id: tenantId,
            site_id: foundation.mainSite.id,
            sale_number: sale.saleNumber,
            status: VehicleSaleStatus.DRAFT,
            vehicle_id: vehicle.id,
            customer_id: sale.customerId,
            sale_price: sale.salePrice,
            contract_concluded_at: sale.contractConcludedAt,
            handed_over_at: sale.handedOverAt,
            buyer_is_consumer: sale.buyerIsConsumer,
            gewaehrleistung_shortened_negotiated: sale.shortenedNegotiated,
            gewaehrleistung_ends_on: snapshot.baseEndsOn,
            presumption_ends_on: snapshot.presumptionEndsOn,
            gewaehrleistung_rule_version: snapshot.ruleVersion,
          },
        });
        const invoiceDate = new Date();
        const dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 14);
        const invoiceNumber = await generateInvoiceNumber(
          tx,
          tenantId,
          invoiceDate.getFullYear(),
        );
        const net = new Prisma.Decimal(sale.salePrice).sub(marginVat);
        const invoice = await tx.invoice.create({
          data: {
            tenant_id: tenantId,
            customer_id: sale.customerId,
            vehicle_id: vehicle.id,
            vehicle_sale_id: createdSale.id,
            site_id: foundation.mainSite.id,
            legal_entity_id: legalEntityId,
            currency: 'EUR',
            tax_mode: InvoiceTaxMode.MARGIN_SCHEME,
            status: InvoiceStatus.FINALIZED,
            invoice_number: invoiceNumber,
            date: invoiceDate,
            due_date: dueDate,
            total_net: net,
            total_tax: marginVat,
            total_gross: sale.salePrice,
            items: {
              create: {
                tenant_id: tenantId,
                description: `${sale.vehicle.year} ${sale.vehicle.make} ${sale.vehicle.model} VIN ${sale.vehicle.vin}`,
                quantity: new Prisma.Decimal(1),
                unit_price: sale.salePrice,
                tax_rate: new Prisma.Decimal(20),
                line_total: sale.salePrice,
                revenue_group_name: 'Vehicle used (margin)',
              },
            },
          },
          include: { items: true, customer: true, vehicle: true },
        });
        const margin = {
          cost_basis: basis.toFixed(2),
          margin_tax: marginVat.toFixed(2),
          tax_rate: '20.00',
          calculation_profile: 'vehicle-margin-v1',
        };
        await snapshotCommit.commitV2Snapshot({
          tx,
          tenantId,
          invoice,
          invoiceNumber,
          margin,
          commitmentContext: {
            tenantId,
            sourceIdentity: {
              sales_order_id: null,
              workshop_order_id: null,
              vehicle_sale_id: createdSale.id,
              site_id: foundation.mainSite.id,
              legal_entity_id: legalEntityId,
            },
            authorizedSiteIds: [foundation.mainSite.id],
            ownership: { siteId: foundation.mainSite.id, legalEntityId },
          },
        });
        await tx.vehicleSale.update({
          where: { id: createdSale.id },
          data: {
            status: VehicleSaleStatus.INVOICED,
            cost_basis_snapshot: basis,
            margin_vat_snapshot: marginVat,
            days_to_sell_snapshot: daysInStock(purchaseDate, invoiceDate),
          },
        });
        await tx.vehicle.update({
          where: { id: vehicle.id },
          data: {
            inventory_role: VehicleInventoryRole.CUSTOMER,
            stock_status: null,
            stock_received_at: null,
            stock_cost_basis: null,
            customer_id: sale.customerId,
            reserved_for_customer_id: null,
          },
        });
        await tx.vehicleLedgerEntry.create({
          data: {
            tenant_id: tenantId,
            vehicle_id: vehicle.id,
            entry_type: VehicleLedgerEntryType.SALE,
            amount: new Prisma.Decimal(sale.salePrice).negated(),
            posting_date: invoiceDate,
            vehicle_sale_id: createdSale.id,
          },
        });
        return { vehicle, createdSale, invoice };
      });
    }),
  );
}

async function generateInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  year: number,
): Promise<string> {
  const sequence = await tx.invoiceSequence.upsert({
    where: { tenant_id_year: { tenant_id: tenantId, year } },
    update: { current: { increment: 1 } },
    create: { tenant_id: tenantId, year, current: 1 },
  });
  return `RE-${year}-${String(sequence.current).padStart(4, '0')}`;
}
