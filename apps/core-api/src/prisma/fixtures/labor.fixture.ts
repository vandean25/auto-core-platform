import type { LaborCategory } from '@prisma/client';
import type { LaborContext, SeedPrismaClient } from './types';

export const LABOR_CATEGORIES_TO_SEED = [
  {
    name: 'Engine',
    description: 'Engine and internal combustion system operations',
    sort_order: 1,
  },
  {
    name: 'Brakes',
    description: 'Brake system inspection and replacement operations',
    sort_order: 2,
  },
  {
    name: 'Electrical',
    description: 'Electrical system diagnostics and repairs',
    sort_order: 3,
  },
  {
    name: 'Suspension',
    description: 'Suspension, steering, and chassis operations',
    sort_order: 4,
  },
  {
    name: 'Transmission',
    description: 'Gearbox, clutch, and drivetrain operations',
    sort_order: 5,
  },
  {
    name: 'General Service',
    description: 'Routine vehicle servicing and inspection operations',
    sort_order: 6,
  },
];

export const LABOR_OPERATION_DEFS = [
  // Engine
  {
    code: 'ENG-001',
    description: 'Engine Oil & Filter Change',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  {
    code: 'ENG-002',
    description: 'Timing Belt Replacement',
    standard_aw: 4.0,
    hourly_rate: 95.0,
  },
  {
    code: 'ENG-003',
    description: 'Engine Diagnostic Scan',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  {
    code: 'ENG-004',
    description: 'Valve Cover Gasket Replacement',
    standard_aw: 2.0,
    hourly_rate: 95.0,
  },
  // Brakes
  {
    code: 'BRK-001',
    description: 'Front Brake Pad Replacement',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  {
    code: 'BRK-002',
    description: 'Rear Brake Pad Replacement',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  {
    code: 'BRK-003',
    description: 'Brake Disc Replacement (Front Axle)',
    standard_aw: 1.5,
    hourly_rate: 95.0,
  },
  {
    code: 'BRK-004',
    description: 'Brake Fluid Flush',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  // Electrical
  {
    code: 'ELEC-001',
    description: 'Battery Replacement & Registration',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  {
    code: 'ELEC-002',
    description: 'Alternator Replacement',
    standard_aw: 2.5,
    hourly_rate: 95.0,
  },
  {
    code: 'ELEC-003',
    description: 'Starter Motor Replacement',
    standard_aw: 2.0,
    hourly_rate: 95.0,
  },
  {
    code: 'ELEC-004',
    description: 'Electrical System Diagnostics',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  // Suspension
  {
    code: 'SUS-001',
    description: 'Front Shock Absorber Replacement (per side)',
    standard_aw: 1.5,
    hourly_rate: 95.0,
  },
  {
    code: 'SUS-002',
    description: 'Rear Shock Absorber Replacement (per side)',
    standard_aw: 1.5,
    hourly_rate: 95.0,
  },
  {
    code: 'SUS-003',
    description: 'Four-Wheel Alignment',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  {
    code: 'SUS-004',
    description: 'Front Control Arm Replacement',
    standard_aw: 2.0,
    hourly_rate: 95.0,
  },
  // Transmission
  {
    code: 'TRANS-001',
    description: 'Manual Gearbox Oil Change',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  {
    code: 'TRANS-002',
    description: 'Clutch Kit Replacement',
    standard_aw: 5.0,
    hourly_rate: 95.0,
  },
  {
    code: 'TRANS-003',
    description: 'Transmission Fault Diagnosis',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  {
    code: 'TRANS-004',
    description: 'Automatic Transmission Fluid Service',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  // General Service
  {
    code: 'GEN-001',
    description: 'Annual Service – Minor (Oil, Filter, Check)',
    standard_aw: 1.0,
    hourly_rate: 95.0,
  },
  {
    code: 'GEN-002',
    description: 'Annual Service – Major (Full Inspection)',
    standard_aw: 2.5,
    hourly_rate: 95.0,
  },
  {
    code: 'GEN-003',
    description: 'Pre-MOT / TÜV Inspection',
    standard_aw: 1.5,
    hourly_rate: 95.0,
  },
  {
    code: 'GEN-004',
    description: 'Cabin & Engine Air Filter Replacement',
    standard_aw: 0.5,
    hourly_rate: 95.0,
  },
  {
    code: 'GEN-005',
    description: 'Wheel Change (Summer/Winter)',
    standard_aw: 0.8,
    hourly_rate: 95.0,
  },
];

/** Resolve category_id from an operation code prefix, or null if no match. */
export function resolveCategoryId(
  code: string,
  categoryByPrefix: Record<string, string>,
): string | null {
  for (const prefix of Object.keys(categoryByPrefix)) {
    if (code.startsWith(`${prefix}-`)) {
      return categoryByPrefix[prefix];
    }
  }
  return null;
}

export async function seedLabor(
  prisma: SeedPrismaClient,
  tenantId: string,
): Promise<LaborContext> {
  console.log('Seeding Labor Categories and Operations...');

  const categoryRecords: LaborCategory[] = await Promise.all(
    LABOR_CATEGORIES_TO_SEED.map((cat) =>
      prisma.laborCategory.upsert({
        where: { tenant_id_name: { tenant_id: tenantId, name: cat.name } },
        update: {
          description: cat.description,
          sort_order: cat.sort_order,
        },
        create: { tenant_id: tenantId, ...cat },
      }),
    ),
  );

  const [
    catEngine,
    catBrakes,
    catElectrical,
    catSuspension,
    catTransmission,
    catGeneral,
  ] = categoryRecords;

  const categoryByPrefix: Record<string, string> = {
    ENG: catEngine.id,
    BRK: catBrakes.id,
    ELEC: catElectrical.id,
    SUS: catSuspension.id,
    TRANS: catTransmission.id,
    GEN: catGeneral.id,
  };

  await Promise.all(
    LABOR_OPERATION_DEFS.map((op) =>
      prisma.laborOperation.upsert({
        where: { tenant_id_code: { tenant_id: tenantId, code: op.code } },
        update: {
          description: op.description,
          standard_aw: op.standard_aw,
          hourly_rate: op.hourly_rate,
          category_id: resolveCategoryId(op.code, categoryByPrefix),
        },
        create: {
          tenant_id: tenantId,
          code: op.code,
          description: op.description,
          standard_aw: op.standard_aw,
          hourly_rate: op.hourly_rate,
          category_id: resolveCategoryId(op.code, categoryByPrefix),
        },
      }),
    ),
  );

  console.log(
    'Categorizing any existing uncategorized LaborOperation records in batch...',
  );
  let categorizedCount = 0;
  for (const [prefix, catId] of Object.entries(categoryByPrefix)) {
    const result = await prisma.laborOperation.updateMany({
      where: {
        tenant_id: tenantId,
        category_id: null,
        code: { startsWith: `${prefix}-` },
      },
      data: {
        category_id: catId,
      },
    });
    categorizedCount += result.count;
  }

  console.log('Seeding specific LaborFitments (for testing)...');
  const [opOilChange, opBrakePad] = await Promise.all([
    prisma.laborOperation.findFirst({
      where: { code: 'ENG-001', tenant_id: tenantId },
    }),
    prisma.laborOperation.findFirst({
      where: { code: 'BRK-001', tenant_id: tenantId },
    }),
  ]);

  const fitmentPromises: Promise<unknown>[] = [];
  if (opOilChange) {
    fitmentPromises.push(
      prisma.laborFitment.create({
        data: {
          labor_operation_id: opOilChange.id,
          make: 'Volkswagen',
          model: 'Golf VII',
          year_from: 2012,
          year_to: 2020,
        },
      }),
    );
  }

  if (opBrakePad) {
    fitmentPromises.push(
      prisma.laborFitment.create({
        data: {
          labor_operation_id: opBrakePad.id,
          make: 'Audi',
          model: 'A4 B9',
          year_from: 2015,
          year_to: 2023,
        },
      }),
    );
  }

  await Promise.all(fitmentPromises);

  return {
    categoryRecords,
    categorizedCount,
  };
}
