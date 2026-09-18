import type { SeedPrismaClient, TenantFoundationContext } from './types.js';

async function seedSiteSystemLocations(
  prisma: SeedPrismaClient,
  tenantId: string,
  siteId: string,
) {
  await prisma.storageLocation.createMany({
    data: [
      {
        tenant_id: tenantId,
        site_id: siteId,
        code: 'TRANSIT',
        name: 'In Transit',
        type: 'in_transit',
        is_system: true,
      },
      {
        tenant_id: tenantId,
        site_id: siteId,
        code: 'LOT',
        name: 'Vehicle Lot',
        type: 'vehicle_lot',
        is_system: false,
      },
    ],
    skipDuplicates: true,
  });
}

export async function seedTenantFoundation(
  prisma: SeedPrismaClient,
): Promise<TenantFoundationContext> {
  console.log('Seeding tenant foundation...');
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: 'default-workshop' },
    update: {},
    create: {
      name: 'Default Workshop',
      slug: 'default-workshop',
      plan: 'STANDARD',
    },
  });

  console.log(
    'Seeding multi-location foundation (legal entity + WIEN/GRZ sites)...',
  );
  const defaultLegalEntity = await prisma.legalEntity.create({
    data: {
      tenant_id: defaultTenant.id,
      name: defaultTenant.name,
      country_iso: 'AT',
      is_active: true,
    },
  });

  const wienSite = await prisma.site.create({
    data: {
      tenant_id: defaultTenant.id,
      legal_entity_id: defaultLegalEntity.id,
      code: 'WIEN',
      name: 'Vienna Workshop',
      timezone: 'Europe/Vienna',
      slot_minutes: 30,
      holiday_country_iso: 'AT',
      is_active: true,
    },
  });

  const grzSite = await prisma.site.create({
    data: {
      tenant_id: defaultTenant.id,
      legal_entity_id: defaultLegalEntity.id,
      code: 'GRZ',
      name: 'Graz Workshop',
      timezone: 'Europe/Vienna',
      slot_minutes: 30,
      holiday_country_iso: 'AT',
      is_active: true,
    },
  });

  await seedSiteSystemLocations(prisma, defaultTenant.id, wienSite.id);
  await seedSiteSystemLocations(prisma, defaultTenant.id, grzSite.id);

  const systemLocations = await prisma.storageLocation.findMany({
    where: {
      tenant_id: defaultTenant.id,
      site_id: wienSite.id,
      code: { in: ['TRANSIT', 'LOT'] },
    },
  });

  return {
    defaultTenant,
    defaultLegalEntity,
    wienSite,
    grzSite,
    // Backward-compatible alias for fixtures that still reference mainSite.
    mainSite: wienSite,
    systemLocations,
  };
}
