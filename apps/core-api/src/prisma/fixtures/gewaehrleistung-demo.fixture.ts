import {
  CustomerType,
  VehicleInventoryRole,
  VehicleSaleStatus,
  VehicleStockStatus,
  VehicleTaxScheme,
} from '@prisma/client';
import type { Customer } from '@prisma/client';
import { computeGewaehrleistung } from '../../vehicle-stock/gewaehrleistung/compute-gewaehrleistung.js';
import type { SeedPrismaClient, TenantFoundationContext } from './types.js';
import { DEMO_GEWAHRLEISTUNG_SALE_NUMBERS } from './gewaehrleistung-demo.constants.js';

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
};

function date(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export async function seedDemoGewaehrleistungSales(
  prisma: SeedPrismaClient,
  foundation: TenantFoundationContext,
  privateCustomers: Array<Pick<Customer, 'id'>>,
  showroom: { id: string },
): Promise<void> {
  const tenantId = foundation.defaultTenant.id;
  const b2bCustomer = await prisma.customer.create({
    data: {
      tenant_id: tenantId,
      type: CustomerType.COMPANY,
      company_name: 'Demo Fuhrpark GmbH',
      first_name: 'Demo',
      last_name: 'Fuhrpark',
      email: 'demo.gewaehrleistung.b2b@example.at',
      address_city: 'Vienna',
      address_zip: '1010',
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
      customerId: privateCustomers[0].id,
      contractConcludedAt: date('2024-10-20'),
      handedOverAt: date('2024-10-25'),
      buyerIsConsumer: true,
      shortenedNegotiated: false,
      salePrice: 18_900,
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
      customerId: privateCustomers[1].id,
      contractConcludedAt: date('2025-10-20'),
      handedOverAt: date('2025-10-25'),
      buyerIsConsumer: true,
      shortenedNegotiated: true,
      salePrice: 24_500,
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

      return prisma.vehicle.create({
        data: {
          tenant_id: tenantId,
          site_id: foundation.mainSite.id,
          location_id: showroom.id,
          inventory_role: VehicleInventoryRole.USED,
          stock_status: VehicleStockStatus.SOLD,
          tax_scheme: VehicleTaxScheme.MARGIN,
          make: sale.vehicle.make,
          model: sale.vehicle.model,
          year: sale.vehicle.year,
          vin: sale.vehicle.vin,
          plate: sale.vehicle.plate,
          first_registration_date: sale.vehicle.firstRegistrationDate,
          customer_id: sale.customerId,
          sales: {
            create: {
              tenant_id: tenantId,
              site_id: foundation.mainSite.id,
              sale_number: sale.saleNumber,
              status: VehicleSaleStatus.INVOICED,
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
          },
        },
      });
    }),
  );
}
