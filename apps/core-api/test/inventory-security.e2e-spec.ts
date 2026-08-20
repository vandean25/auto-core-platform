import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createGlobalValidationPipe } from '../src/common';
import { AuthService } from '../src/auth/auth.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { cleanupTestTenantGraph, createTestAuthToken, createTestTenant } from './tenant-test-utils';
import { teardownTestApp } from './test-lifecycle';

describe('InventoryController (e2e) Security', () => {
  let app: INestApplication;
  let authToken: string;
  let prisma: PrismaService;
  let tenantId: string;
  const mockInventoryService = {
    createItem: jest.fn().mockImplementation((dto) => {
      return Promise.resolve({
        id: 'test-id',
        ...dto,
      });
    }),
    findAll: jest.fn().mockResolvedValue([]),
    checkAvailability: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(InventoryService)
      .useValue(mockInventoryService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();
    prisma = app.get(PrismaService);
    const testTenant = await createTestTenant(prisma, 'inventory-security');
    tenantId = testTenant.tenantId;
    authToken = createTestAuthToken(app.get(AuthService), testTenant);
  });

  afterEach(async () => {
    if (tenantId) {
      await cleanupTestTenantGraph(prisma, tenantId);
      tenantId = '';
    }
    await teardownTestApp(app, prisma);
  });

  it('should reject requests with missing required fields', () => {
    return request(app.getHttpServer())
      .post('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        // missing sku, name, prices
      })
      .expect(400);
  });

  it('should reject requests with invalid types', () => {
    return request(app.getHttpServer())
      .post('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        sku: 123, // should be string
        name: 'Test Item',
        cost_price: 'free', // should be number
        retail_price: 100,
      })
      .expect(400);
  });

  it('should reject requests with negative prices', () => {
    return request(app.getHttpServer())
      .post('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        sku: 'TEST-SKU',
        name: 'Test Item',
        cost_price: -10,
        retail_price: 100,
      })
      .expect(400);
  });

  it('should accept valid requests', () => {
    return request(app.getHttpServer())
      .post('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
      .send({
        sku: 'TEST-SKU-VALID',
        name: 'Valid Item',
        cost_price: 10.5,
        retail_price: 20.0,
        unit: 'box',
        brandId: 1,
      })
      .expect(201)
      .expect((res: any) => {
        expect(res.body.sku).toBe('TEST-SKU-VALID');
      });
  });
});
