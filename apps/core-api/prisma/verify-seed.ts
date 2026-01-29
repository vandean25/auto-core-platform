import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

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
    const stockA = await prisma.inventoryStock.findUnique({ where: { catalog_item_id: partA?.id } });
    const stockB = await prisma.inventoryStock.findUnique({ where: { catalog_item_id: partB?.id } });
    const stockC = await prisma.inventoryStock.findUnique({ where: { catalog_item_id: partC?.id } });

    console.log(`Stock for A: ${stockA ? 'Exists (Incorrect)' : 'None (Correct)'}`);
    console.log(`Stock for B: ${stockB ? 'Exists (Incorrect)' : 'None (Correct)'}`);
    console.log(`Stock for C: ${stockC ? `Found: ${stockC.quantity_on_hand} (Correct)` : 'None (Incorrect)'}`);

    console.log('--- Verification Finished ---');
}

verify()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });
