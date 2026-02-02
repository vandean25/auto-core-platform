import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Location Hierarchy (e2e)', () => {
    let app: INestApplication;
    let prisma: PrismaService;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.setGlobalPrefix('api');
        await app.init();

        prisma = app.get<PrismaService>(PrismaService);
        
        // Clean up
        await prisma.inventoryTransaction.deleteMany();
        await prisma.inventoryStock.deleteMany();
        await prisma.storageLocation.deleteMany();
    });

    afterAll(async () => {
        await app.close();
    });

    it('should create a full hierarchy', async () => {
        // 1. Warehouse
        const whRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Main Warehouse', code: 'WH-001', type: 'warehouse' })
            .expect(201);
        const whId = whRes.body.id;

        // 2. Aisle
        const aisleRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Aisle A', code: 'AISLE-A', type: 'aisle', parentId: whId })
            .expect(201);
        const aisleId = aisleRes.body.id;

        // 3. Shelf
        const shelfRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Shelf 1', code: 'SHELF-1', type: 'shelf', parentId: aisleId })
            .expect(201);
        const shelfId = shelfRes.body.id;

        // 4. Bin
        const binRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Bin X', code: 'BIN-X', type: 'bin', parentId: shelfId })
            .expect(201);
        
        expect(binRes.body.parent_id).toBe(shelfId);
    });

    it('should prevent invalid hierarchy', async () => {
        // Warehouse cannot have parent (assuming creating another WH first)
        const whRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Parent WH', code: 'WH-PARENT', type: 'warehouse' })
            .expect(201);
        
        await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Child WH', code: 'WH-CHILD', type: 'warehouse', parentId: whRes.body.id })
            .expect(400);

        // Aisle must have parent
        await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'Orphan Aisle', code: 'AISLE-ORPHAN', type: 'aisle' })
            .expect(400);
    });

    it('should return the tree structure', async () => {
        const res = await request(app.getHttpServer())
            .get('/api/inventory/locations/tree')
            .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        const mainWh = res.body.find((l: any) => l.code === 'WH-001');
        expect(mainWh).toBeDefined();
        expect(mainWh.children.length).toBeGreaterThan(0);
        expect(mainWh.children[0].type).toBe('aisle');
        expect(mainWh.children[0].children[0].type).toBe('shelf');
    });

    it('should soft delete a location', async () => {
        // Create isolated location
        const whRes = await request(app.getHttpServer())
            .post('/api/inventory/locations')
            .send({ name: 'To Delete', code: 'WH-DEL', type: 'warehouse' })
            .expect(201);

        await request(app.getHttpServer())
            .delete(`/api/inventory/locations/${whRes.body.id}`)
            .expect(200);

        // Should not appear in findAll
        const listRes = await request(app.getHttpServer())
            .get('/api/inventory/locations')
            .expect(200);
        
        const found = listRes.body.find((l: any) => l.code === 'WH-DEL');
        expect(found).toBeUndefined();
    });
});
