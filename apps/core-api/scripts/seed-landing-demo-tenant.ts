import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  seedBrands,
  seedCustomersAndVehicles,
  seedFinance,
  seedInventory,
  seedLabor,
  seedPickerlInspectionTemplate,
} from '../src/prisma/fixtures/index.js';
import { DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS } from '../src/prisma/fixtures/demo-legal-entity-seller.fixture.js';

const DEMO_TENANT_SLUG =
  process.env.LANDING_DEMO_TENANT_SLUG?.trim() || 'selbstservice-demo';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`Seeding landing demo tenant (${DEMO_TENANT_SLUG})...`);

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: {
      is_landing_demo_tenant: true,
      is_active: true,
      name: 'Demo Werkstatt Alpenblick',
    },
    create: {
      name: 'Demo Werkstatt Alpenblick',
      slug: DEMO_TENANT_SLUG,
      plan: 'STANDARD',
      is_landing_demo_tenant: true,
    },
  });

  let legalEntity = await prisma.legalEntity.findFirst({
    where: { tenant_id: tenant.id },
  });
  if (!legalEntity) {
    legalEntity = await prisma.legalEntity.create({
      data: {
        tenant_id: tenant.id,
        name: tenant.name,
        country_iso: 'AT',
        is_active: true,
        ...DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS,
      },
    });
  }

  let mainSite = await prisma.site.findFirst({
    where: { tenant_id: tenant.id, code: 'MAIN' },
  });
  if (!mainSite) {
    mainSite = await prisma.site.create({
      data: {
        tenant_id: tenant.id,
        legal_entity_id: legalEntity.id,
        code: 'MAIN',
        name: 'Werkstatt Salzburg',
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
  }

  await prisma.storageLocation.createMany({
    data: [
      {
        tenant_id: tenant.id,
        site_id: mainSite.id,
        code: 'TRANSIT',
        name: 'Unterwegs',
        type: 'in_transit',
        is_system: true,
      },
      {
        tenant_id: tenant.id,
        site_id: mainSite.id,
        code: 'A1',
        name: 'Regal A1',
        type: 'shelf',
        is_system: false,
      },
      {
        tenant_id: tenant.id,
        site_id: mainSite.id,
        code: 'LOT',
        name: 'Fahrzeugplatz',
        type: 'vehicle_lot',
        is_system: false,
      },
    ],
    skipDuplicates: true,
  });

  const finance = await seedFinance(prisma, tenant.id);
  await seedPickerlInspectionTemplate(prisma, tenant.id);

  const foundation = {
    defaultTenant: tenant,
    defaultLegalEntity: legalEntity,
    mainSite,
    grzSite: mainSite,
    systemLocations: [],
  };

  const catalogCount = await prisma.catalogItem.count({
    where: { tenant_id: tenant.id },
  });
  if (catalogCount === 0) {
    const brands = await seedBrands(prisma, tenant.id);
    await seedInventory(prisma, foundation, finance, brands.allBrands);
    await seedLabor(prisma, tenant.id);
    await seedCustomersAndVehicles(prisma, tenant.id);
  } else {
    console.log('  → demo catalog already present, skipping transactional fixtures');
  }

  console.log('Landing demo tenant seed completed.');
  console.log(`  tenant_id=${tenant.id}`);
  console.log(`  slug=${tenant.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
