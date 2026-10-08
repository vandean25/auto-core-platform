import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { DEMO_GEWAHRLEISTUNG_SALE_NUMBERS } from '../src/prisma/fixtures/gewaehrleistung-demo.constants.js';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const expectedGewaehrleistungSales = {
    'DEMO-GW-2Y': {
        contract: '2024-10-20',
        handover: '2024-10-25',
        consumer: true,
        shortened: false,
        baseEnd: '2026-10-25',
        presumptionEnd: '2025-10-25',
        ruleVersion: 'at-used-vehicle-vgg-2022-v1',
        customerType: 'PRIVATE',
        customerEmail: 'demo.gewaehrleistung.2y@example.at',
    },
    'DEMO-GW-1Y': {
        contract: '2025-10-20',
        handover: '2025-10-25',
        consumer: true,
        shortened: true,
        baseEnd: '2026-10-25',
        presumptionEnd: '2026-10-25',
        ruleVersion: 'at-used-vehicle-vgg-2022-v1',
        customerType: 'PRIVATE',
        customerEmail: 'demo.gewaehrleistung.1y@example.at',
    },
    'DEMO-GW-B2B': {
        contract: '2026-10-01',
        handover: '2026-10-06',
        consumer: false,
        shortened: false,
        baseEnd: null,
        presumptionEnd: null,
        ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
        customerType: 'COMPANY',
        customerEmail: 'demo.gewaehrleistung.b2b@example.at',
    },
} as const;

function asIsoDate(value: Date | null): string | null {
    return value?.toISOString().slice(0, 10) ?? null;
}

async function verify() {
    console.log('--- Verification Started ---');

    // 1. Warehouses
    const locations = await prisma.storageLocation.findMany();
    console.log(`Warehouses found: ${locations.length} (Expected: 3)`);
    locations.forEach(l => console.log(` - ${l.name}`));

    // 2. Catalog Items
    const itemCount = await prisma.catalogItem.count();
    console.log(`Total items found: ${itemCount} (Expected: 50)`);

    // 3. Supersession Chain
    const partA = await prisma.catalogItem.findUnique({ where: { sku: '06J-115-403-C' } });
    const partB = await prisma.catalogItem.findUnique({ where: { sku: '06J-115-403-Q' } });
    const partC = await prisma.catalogItem.findUnique({ where: { sku: '06J-115-561-B' } });

    if (partA && partB && partC) {
        console.log(`Chain Link 1: ${partA.sku} -> ${partA.superseded_by_id === partB.id ? 'Correct (Part B)' : 'Incorrect'}`);
        console.log(`Chain Link 2: ${partB.sku} -> ${partB.superseded_by_id === partC.id ? 'Correct (Part C)' : 'Incorrect'}`);
    } else {
        console.log('Error: Could not find supersession parts');
    }

    // 4. Stock for Chain
    const stockA = await prisma.inventoryStock.findFirst({ where: { catalog_item_id: partA?.id } });
    const stockB = await prisma.inventoryStock.findFirst({ where: { catalog_item_id: partB?.id } });
    const stockC = await prisma.inventoryStock.findFirst({ where: { catalog_item_id: partC?.id } });

    console.log(`Stock for A: ${stockA ? 'Exists (Incorrect)' : 'None (Correct)'}`);
    console.log(`Stock for B: ${stockB ? 'Exists (Incorrect)' : 'None (Correct)'}`);
    console.log(`Stock for C: ${stockC ? `Found: ${stockC.quantity_on_hand.toString()} (Correct)` : 'None (Incorrect)'}`);

    const stockVehicles = await prisma.vehicle.findMany({
        where: {
            inventory_role: { in: ['USED', 'NEW', 'DEMO'] },
            stock_status: { not: null },
        },
        select: {
            purchases: { where: { status: 'RECEIVED' }, select: { received_at: true } },
            ledger_entries: { where: { entry_type: 'PURCHASE' }, orderBy: { posting_date: 'asc' }, take: 1, select: { posting_date: true } },
        },
    });
    const ageBuckets = new Set<string>();
    const today = new Date();
    const utcToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    for (const vehicle of stockVehicles) {
        const stockIn = vehicle.purchases.find((purchase) => purchase.received_at)?.received_at
            ?? vehicle.ledger_entries[0]?.posting_date;
        if (!stockIn) continue;
        const utcStockIn = Date.UTC(stockIn.getUTCFullYear(), stockIn.getUTCMonth(), stockIn.getUTCDate());
        const days = Math.floor((utcToday - utcStockIn) / 86_400_000);
        ageBuckets.add(days <= 30 ? '0_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : days <= 180 ? '91_180' : 'over_180');
    }
    const expectedAgeBuckets = ['0_30', '31_60', '61_90', '91_180', 'over_180'];
    const missingAgeBuckets = expectedAgeBuckets.filter((bucket) => !ageBuckets.has(bucket));
    if (missingAgeBuckets.length > 0) {
        throw new Error(`Vehicle stock demo is missing age buckets: ${missingAgeBuckets.join(', ')}`);
    }
    console.log(`Vehicle stock age buckets verified: ${expectedAgeBuckets.join(', ')}`);

    const gewaehrleistungSales = await prisma.vehicleSale.findMany({
        where: {
            tenant: { is: { slug: 'default-workshop' } },
            sale_number: { in: [...DEMO_GEWAHRLEISTUNG_SALE_NUMBERS] },
        },
        include: {
            vehicle: {
                select: {
                    inventory_role: true,
                    stock_status: true,
                    ledger_entries: { select: { entry_type: true, amount: true, vehicle_sale_id: true } },
                },
            },
            customer: {
                select: {
                    type: true,
                    email: true,
                    address_street: true,
                    address_zip: true,
                    address_city: true,
                    address_country: true,
                },
            },
            invoice: { select: { status: true, tax_mode: true, vehicle_sale_id: true, items: { select: { id: true } } } },
        },
    });
    if (gewaehrleistungSales.length !== DEMO_GEWAHRLEISTUNG_SALE_NUMBERS.length) {
        throw new Error(
            `Expected ${DEMO_GEWAHRLEISTUNG_SALE_NUMBERS.length} AUT-408 demo sales, found ${gewaehrleistungSales.length}`,
        );
    }
    for (const sale of gewaehrleistungSales) {
        const expected = expectedGewaehrleistungSales[sale.sale_number as keyof typeof expectedGewaehrleistungSales];
        if (!expected) {
            throw new Error(`Unexpected AUT-408 demo sale: ${sale.sale_number}`);
        }
        const actual = {
            contract: asIsoDate(sale.contract_concluded_at),
            handover: asIsoDate(sale.handed_over_at),
            consumer: sale.buyer_is_consumer,
            shortened: sale.gewaehrleistung_shortened_negotiated,
            baseEnd: asIsoDate(sale.gewaehrleistung_ends_on),
            presumptionEnd: asIsoDate(sale.presumption_ends_on),
            ruleVersion: sale.gewaehrleistung_rule_version,
            customerType: sale.customer.type,
            customerEmail: sale.customer.email,
        };
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
            throw new Error(
                `AUT-408 demo sale ${sale.sale_number} facts/snapshot mismatch: ${JSON.stringify(actual)}`,
            );
        }
        if (
            actual.contract === actual.handover ||
            sale.status !== 'INVOICED' ||
            sale.vehicle.inventory_role !== 'CUSTOMER' ||
            sale.vehicle.stock_status !== null ||
            !sale.customer.address_street?.trim() ||
            !sale.customer.address_zip?.trim() ||
            !sale.customer.address_city?.trim() ||
            !sale.customer.address_country?.trim() ||
            !sale.invoice ||
            sale.invoice.status !== 'FINALIZED' ||
            sale.invoice.tax_mode !== 'MARGIN_SCHEME' ||
            sale.invoice.vehicle_sale_id !== sale.id ||
            sale.invoice.items.length !== 1 ||
            !sale.vehicle.ledger_entries.some((entry) => entry.entry_type === 'PURCHASE' && entry.amount.gt(0)) ||
            !sale.vehicle.ledger_entries.some((entry) => entry.entry_type === 'SALE' && entry.amount.lt(0) && entry.vehicle_sale_id === sale.id)
        ) {
            throw new Error(`AUT-408 demo sale ${sale.sale_number} is not a distinct sold-vehicle example`);
        }
    }
    console.log('AUT-408 Gewährleistung demo sales verified: 2-year B2C, negotiated 1-year B2C, B2B');

    console.log('--- Verification Finished ---');
}

verify()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
