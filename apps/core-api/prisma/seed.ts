import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  cleanDb,
  seedTenantFoundation,
  seedFinance,
  seedBrands,
  seedVendors,
  seedInventory,
  seedLabor,
  seedCustomersAndVehicles,
} from '../src/prisma/fixtures';

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  await cleanDb(prisma);

  const foundation = await seedTenantFoundation(prisma);
  const finance = await seedFinance(prisma, foundation.defaultTenant.id);
  const brands = await seedBrands(prisma, foundation.defaultTenant.id);
  const inventory = await seedInventory(prisma, foundation, finance, brands.allBrands);
  const labor = await seedLabor(prisma, foundation.defaultTenant.id);
  const vendors = await seedVendors(prisma, foundation.defaultTenant.id, brands.allBrands);
  const customers = await seedCustomersAndVehicles(prisma, foundation.defaultTenant.id);

  console.log('Seed completed successfully!');
  console.log('✓ All inventory movements recorded as transactions');
  console.log('✓ Stock cache updated accordingly');
  console.log('✓ Revenue groups and default finance settings created');
  console.log('✓ Brands (Dual/Pure) created and linked to items');
  console.log(`✓ ${labor.categoryRecords.length} labor categories created/updated`);
  console.log(`✓ Labor operations seeded and categorized in batch`);
  console.log(`✓ ${vendors.length} vendors created (one per brand)`);
  console.log(`✓ ${customers.customers.length} customers and their vehicles created`);
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