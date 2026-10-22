import 'dotenv/config';
import { PrismaClient, TenantMemberRole } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  seedBrands,
  seedCustomersAndVehicles,
  seedFinance,
  seedInventory,
  seedLabor,
  seedPickerlInspectionTemplate,
  seedAnnahmeCheckInspectionTemplate,
} from '../src/prisma/fixtures/index.js';
import { DEFAULT_WORKSHOP_DEMO_SELLER_FIELDS } from '../src/prisma/fixtures/demo-legal-entity-seller.fixture.js';
import { loadSeedMasterCopy } from '../src/prisma/fixtures/seed-master-copy.js';

const DEMO_TENANT_SLUG =
  process.env.LANDING_DEMO_TENANT_SLUG?.trim() || 'selbstservice-demo';

const LANDING_DEMO_LANGUAGE = 'en' as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function assertSlugNotHijacked(): Promise<void> {
  const existing = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
    select: { id: true, is_landing_demo_tenant: true },
  });

  if (!existing) {
    return;
  }

  if (!existing.is_landing_demo_tenant) {
    throw new Error(
      `Refusing to seed landing demo tenant: slug "${DEMO_TENANT_SLUG}" already belongs to a non-demo tenant.`,
    );
  }

  const nonDemoMember = await prisma.tenantMember.findFirst({
    where: {
      tenant_id: existing.id,
      is_active: true,
      role: { not: TenantMemberRole.DEMO },
    },
    select: { id: true },
  });

  if (nonDemoMember) {
    throw new Error(
      `Refusing to seed landing demo tenant: slug "${DEMO_TENANT_SLUG}" already has non-demo memberships.`,
    );
  }
}

async function seedLandingDemoEnglishUser(tenantId: string, siteId: string) {
  const email = 'demo-en@auto.core.at';
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      locale: 'en',
      active_tenant_id: tenantId,
      active_site_id: siteId,
    },
    create: {
      email,
      locale: 'en',
      active_tenant_id: tenantId,
      active_site_id: siteId,
    },
  });

  await prisma.tenantMember.upsert({
    where: {
      tenant_id_user_id: { tenant_id: tenantId, user_id: user.id },
    },
    update: { role: TenantMemberRole.DEMO, is_active: true },
    create: {
      tenant_id: tenantId,
      user_id: user.id,
      role: TenantMemberRole.DEMO,
      is_active: true,
    },
  });

  await prisma.siteMembership.upsert({
    where: {
      tenant_id_user_id_site_id: {
        tenant_id: tenantId,
        user_id: user.id,
        site_id: siteId,
      },
    },
    update: { is_active: true },
    create: {
      tenant_id: tenantId,
      user_id: user.id,
      site_id: siteId,
      is_active: true,
    },
  });
}

async function main() {
  console.log(`Seeding landing demo tenant (${DEMO_TENANT_SLUG})...`);

  await assertSlugNotHijacked();

  const master = loadSeedMasterCopy(LANDING_DEMO_LANGUAGE);

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: {
      is_landing_demo_tenant: true,
      is_active: true,
      name: master.landingDemo.tenantName,
      default_locale: LANDING_DEMO_LANGUAGE,
    },
    create: {
      name: master.landingDemo.tenantName,
      slug: DEMO_TENANT_SLUG,
      is_landing_demo_tenant: true,
      default_locale: LANDING_DEMO_LANGUAGE,
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
        name: master.landingDemo.siteName,
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });
  } else {
    mainSite = await prisma.site.update({
      where: { id: mainSite.id },
      data: { name: master.landingDemo.siteName },
    });
  }

  for (const location of [
    {
      code: 'TRANSIT',
      name: master.landingDemo.storage.TRANSIT,
      type: 'in_transit' as const,
      is_system: true,
    },
    {
      code: 'A1',
      name: master.landingDemo.storage.A1,
      type: 'shelf' as const,
      is_system: false,
    },
    {
      code: 'LOT',
      name: master.landingDemo.storage.LOT,
      type: 'vehicle_lot' as const,
      is_system: false,
    },
  ]) {
    await prisma.storageLocation.upsert({
      where: {
        tenant_id_site_id_code: {
          tenant_id: tenant.id,
          site_id: mainSite.id,
          code: location.code,
        },
      },
      update: { name: location.name },
      create: {
        tenant_id: tenant.id,
        site_id: mainSite.id,
        code: location.code,
        name: location.name,
        type: location.type,
        is_system: location.is_system,
      },
    });
  }

  const finance = await seedFinance(prisma, tenant.id);
  await seedPickerlInspectionTemplate(prisma, tenant.id, {
    language: LANDING_DEMO_LANGUAGE,
    refreshLocalizedCopy: true,
  });
  await seedAnnahmeCheckInspectionTemplate(prisma, tenant.id, {
    language: LANDING_DEMO_LANGUAGE,
    refreshLocalizedCopy: true,
  });

  const foundation = {
    defaultTenant: tenant,
    defaultLegalEntity: legalEntity,
    mainSite,
    grzSite: mainSite,
    systemLocations: [],
  };

  const brands = await seedBrands(prisma, tenant.id);
  await seedInventory(prisma, foundation, finance, brands.allBrands);
  await seedLabor(prisma, tenant.id);
  await seedCustomersAndVehicles(prisma, tenant.id);
  await seedLandingDemoEnglishUser(tenant.id, mainSite.id);

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
