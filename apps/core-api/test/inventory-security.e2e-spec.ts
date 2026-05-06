import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { InventoryService } from '../src/inventory/inventory.service';
import { teardownTestApp } from './test-lifecycle';

describe('InventoryController (e2e) Security', () => {
  let app: INestApplication;
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
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
  });

  afterEach(async () => {
    await teardownTestApp(app);
  });

  it('should reject requests with missing required fields', () => {
    return request(app.getHttpServer())
      .post('/inventory')
      .send({
        // missing sku, name, prices
      })
      .expect(400);
  });

  it('should reject requests with invalid types', () => {
    return request(app.getHttpServer())
      .post('/inventory')
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
      .post('/inventory')
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
      .post('/inventory')
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
