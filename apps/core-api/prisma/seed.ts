import 'dotenv/config';
import { PrismaClient, LocationType } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function cleanDb() {
    console.log('Cleaning database...');
    // Delete in order to satisfy foreign key constraints
    await prisma.inventoryStock.deleteMany();
    await prisma.catalogItem.deleteMany();
    await prisma.storageLocation.deleteMany();
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
            brand: 'VAG',
            name: 'Oil Filter (Legacy)',
            cost_price: 8.50,
            retail_price: 15.00,
        },
    });

    const partB = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-403-Q',
            brand: 'VAG',
            name: 'Oil Filter (Improved)',
            cost_price: 9.00,
            retail_price: 16.50,
        },
    });

    const partC = await prisma.catalogItem.create({
        data: {
            sku: '06J-115-561-B',
            brand: 'VAG',
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
    const brands = ['Bosch', 'Mahle', 'Brembo', 'Shell', 'NGK', 'Valeo', 'Castrol'];
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

    console.log('Seeding stock...');
    // Only Part C has stock
    await prisma.inventoryStock.create({
        data: {
            catalog_item_id: partC.id,
            location_id: showroom.id,
            quantity_on_hand: 25,
            quantity_reserved: 2,
        },
    });

    // Random stock for other parts
    for (const part of otherParts) {
        if (Math.random() > 0.3) {
            await prisma.inventoryStock.create({
                data: {
                    catalog_item_id: part.id,
                    location_id: locations[Math.floor(Math.random() * locations.length)].id,
                    quantity_on_hand: Math.floor(Math.random() * 50) + 1,
                    quantity_reserved: Math.floor(Math.random() * 5),
                },
            });
        }
    }

    console.log('Seed completed successfully!');
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
