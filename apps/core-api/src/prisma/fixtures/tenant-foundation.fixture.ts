import type { SeedPrismaClient, TenantFoundationContext } from './types';

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
    'Seeding multi-location foundation (legal entity + MAIN site)...',
  );
  const defaultLegalEntity = await prisma.legalEntity.create({
    data: {
      tenant_id: defaultTenant.id,
      name: defaultTenant.name,
      country_iso: 'AT',
      is_active: true,
    },
  });

  const mainSite = await prisma.site.create({
    data: {
      tenant_id: defaultTenant.id,
      legal_entity_id: defaultLegalEntity.id,
      code: 'MAIN',
      name: defaultTenant.name,
      timezone: 'Europe/Vienna',
      slot_minutes: 30,
      holiday_country_iso: 'AT',
      is_active: true,
    },
  });

  await prisma.storageLocation.createMany({
    data: [
      {
        tenant_id: defaultTenant.id,
        site_id: mainSite.id,
        code: 'TRANSIT',
        name: 'In Transit',
        type: 'in_transit',
        is_system: true,
      },
      {
        tenant_id: defaultTenant.id,
        site_id: mainSite.id,
        code: 'LOT',
        name: 'Vehicle Lot',
        type: 'vehicle_lot',
        is_system: false,
      },
    ],
    skipDuplicates: true,
  });

  const systemLocations = await prisma.storageLocation.findMany({
    where: {
      tenant_id: defaultTenant.id,
      site_id: mainSite.id,
      code: { in: ['TRANSIT', 'LOT'] },
    },
  });

  return {
    defaultTenant,
    defaultLegalEntity,
    mainSite,
    systemLocations,
  };
}
