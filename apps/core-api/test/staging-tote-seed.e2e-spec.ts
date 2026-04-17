import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { seedFixedStagingTotes } from '../src/prisma/seed-staging-totes';

describe('Staging Tote Seed (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let warehouseId: string;

  const toteCodes = Array.from({ length: 50 }, (_, index) => {
    const value = String(index + 1).padStart(3, '0');
    return `TOTE-${value}`;
  });

  beforeAll(async () => {
    process.env.API_KEY = 'test-api-key';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = app.get<PrismaService>(PrismaService);

    const warehouse = await prisma.storageLocation.upsert({
      where: { code: 'WH-STAGE-TOTE-E2E' },
      update: {
        name: 'Staging Tote E2E Warehouse',
        type: 'warehouse',
        parent_id: null,
      },
      create: {
        code: 'WH-STAGE-TOTE-E2E',
        name: 'Staging Tote E2E Warehouse',
        type: 'warehouse',
      },
    });

    warehouseId = warehouse.id;
  });

  beforeEach(async () => {
    await prisma.storageLocation.deleteMany({
      where: {
        code: { in: toteCodes },
      },
    });
  });

  afterAll(async () => {
    await prisma.storageLocation.deleteMany({
      where: {
        code: { in: toteCodes },
      },
    });

    await prisma.storageLocation.deleteMany({
      where: { id: warehouseId },
    });

    await app.close();
  });

  it('creates 50 fixed staging totes and stays idempotent on reruns', async () => {
    const firstRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: warehouseId,
    });

    expect(firstRun).toEqual({
      total: 50,
      created: 50,
      updated: 0,
      unchanged: 0,
    });

    const seededTotes = await prisma.storageLocation.findMany({
      where: {
        code: { in: toteCodes },
      },
      orderBy: { code: 'asc' },
    });

    expect(seededTotes).toHaveLength(50);
    expect(seededTotes[0].code).toBe('TOTE-001');
    expect(seededTotes[49].code).toBe('TOTE-050');
    seededTotes.forEach((location) => {
      expect(location.type).toBe('staging_tote');
    });

    const secondRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: warehouseId,
    });

    expect(secondRun).toEqual({
      total: 50,
      created: 0,
      updated: 0,
      unchanged: 50,
    });

    await prisma.storageLocation.update({
      where: { code: 'TOTE-010' },
      data: {
        name: 'Mutated Tote Name',
      },
    });

    const thirdRun = await seedFixedStagingTotes(prisma, {
      parentLocationId: warehouseId,
    });

    expect(thirdRun).toEqual({
      total: 50,
      created: 0,
      updated: 1,
      unchanged: 49,
    });

    const restoredTote = await prisma.storageLocation.findUnique({
      where: { code: 'TOTE-010' },
    });

    expect(restoredTote?.name).toBe('Staging Tote 010');
    expect(restoredTote?.type).toBe('staging_tote');
    expect(restoredTote?.parent_id).toBe(warehouseId);
  });
});
