import 'dotenv/config';
import { PrismaClient, LocationType, TransactionType } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function cleanDb() {
    console.log('Cleaning database...');
    // Delete in order to satisfy foreign key constraints
    await prisma.purchaseOrderItem.deleteMany();
    await prisma.purchaseOrder.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.inventoryTransaction.deleteMany();
    await prisma.inventoryStock.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.storageLocation.deleteMany();
}

/**
 * Helper function to record an inventory transaction (ledger-based approach)
 */
async function recordInitialStock(
    itemId: string,
    locationId: string,
    quantity: number,
    costBasis: number,
    reserved: number = 0
) {
    // Create the transaction record
    await prisma.inventoryTransaction.create({
        data: {
            item_id: itemId,
            location_id: locationId,
            quantity: quantity,
            type: TransactionType.INITIAL_BALANCE,
            reference_id: 'SEED_SCRIPT',
            cost_basis: costBasis,
        },
    });

    // Update the cached stock
    await prisma.inventoryStock.upsert({
        where: {
            catalog_item_id_location_id: {
                catalog_item_id: itemId,
                location_id: locationId,
            },
        },
        update: {
            quantity_on_hand: { increment: quantity },
        },
        create: {
            catalog_item_id: itemId,
            location_id: locationId,
            quantity_on_hand: quantity,
            quantity_reserved: reserved,
        },
    });
}

async function main() {
    await cleanDb();

    console.log('Seeding warehouses...');
    const showroom = await prisma.storageLocation.create({
        data: {
            name: 'Main Showroom (Vienna)',
            type: LocationType.warehouse,
        },
    });

    const storage = await prisma.storageLocation.create({
        data: {
            name: 'Workshop Storage (Graz)',
            type: LocationType.warehouse,
        },
    });

    const tireHotel = await prisma.storageLocation.create({
        data: {
            name: 'Tire Hotel (Basement)',
            type: LocationType.warehouse,
        },
    });

    const locations = [showroom, storage, tireHotel];

    console.log('Seeding supersession items (Phase 1: Creation)...');
    const partA = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-403-C',
            brand: 'VW',
            name: 'Oil Filter (Legacy)',
            cost_price: 8.50,
            retail_price: 15.00,
        },
    });

    const partB = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-403-Q',
            brand: 'VW',
            name: 'Oil Filter (Improved)',
            cost_price: 9.00,
            retail_price: 16.50,
        },
    });

    const partC = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-561-B',
            brand: 'VW',
            name: 'Oil Filter (Current)',
            cost_price: 10.20,
            retail_price: 18.00,
        },
    });

    console.log('Seeding supersession items (Phase 2: Linking)...');
    await prisma.catalogItem.update({
        where: { id: partA.id },
        data: { superseded_by_id: partB.id },
    });

    await prisma.catalogItem.update({
        where: { id: partB.id },
        data: { superseded_by_id: partC.id },
    });

    console.log('Seeding 47 more auto parts...');
    const brands = ['VW', 'Audi', 'BMW', 'Mercedes-Benz', 'Ford', 'Toyota', 'Honda', 'Porsche', 'Opel', 'Skoda', 'Castrol', 'Bosch'];
    const categories = [
        { name: 'Oil Filter', prefix: 'OF' },
        { name: 'Brake Pads', prefix: 'BP' },
        { name: 'Synthetic Oil (5W-30)', prefix: 'OIL' },
        { name: 'Wiper Blades', prefix: 'WB' },
        { name: 'Spark Plug', prefix: 'SP' },
        { name: 'Air Filter', prefix: 'AF' },
    ];

    const otherParts: any[] = [];
    for (let i = 1; i <= 47; i++) {
        const brand = brands[Math.floor(Math.random() * brands.length)];
        const category = categories[Math.floor(Math.random() * categories.length)];
        const sku = `${category.prefix}-${1000 + i}-${brand.substring(0, 3).toUpperCase()}`;

        const part = await prisma.catalogItem.create({
            data: {
                sku,
                brand,
                name: `${category.name} - ${brand} model ${i}`,
                cost_price: Math.random() * 50 + 10,
                retail_price: Math.random() * 100 + 60,
            },
        });
        otherParts.push(part);
    }

    console.log('Seeding stock using ledger-based transactions...');
    // Only Part C has stock (using transaction-based approach)
    await recordInitialStock(
        partC.id,
        showroom.id,
        25,
        Number(partC.cost_price),
        2 // reserved quantity
    );

    // Random stock for other parts (using transaction-based approach)
    for (const part of otherParts) {
        if (Math.random() > 0.3) {
            const quantity = Math.floor(Math.random() * 50) + 1;
            const reserved = Math.floor(Math.random() * 5);
            const location = locations[Math.floor(Math.random() * locations.length)];

            await recordInitialStock(
                part.id,
                location.id,
                quantity,
                Number(part.cost_price),
                reserved
            );
        }
    }

    console.log('Seed completed successfully!');
    console.log('✓ All inventory movements recorded as transactions');
    console.log('✓ Stock cache updated accordingly');
}

main()
    .catch((e) => {
        console.error('SEED_FAILURE_START');
        console.error(e);
        if (e.code) console.error('Error Code:', e.code);
        if (e.meta) console.error('Error Meta:', JSON.stringify(e.meta));
        console.error('SEED_FAILURE_END');
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
