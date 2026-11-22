import {
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { WorkshopCheckInController } from './workshop-check-in.controller.js';
import { WorkshopCheckInService } from './workshop-check-in.service.js';
import { WorkshopCheckInMediaService } from './workshop-check-in-media.service.js';
import { WorkshopInspectionService } from './workshop-inspection.service.js';
import type { WorkshopCheckInResponseDto } from './dto/workshop-check-in.dto.js';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

describe('WorkshopCheckInController (AUT-1034)', () => {
  let app: INestApplication;
  let getMock: jest.Mock<Promise<WorkshopCheckInResponseDto | null>, [string]>;

  beforeEach(async () => {
    getMock = jest.fn();
    const moduleRef = await Test.createTestingModule({
      controllers: [WorkshopCheckInController],
      providers: [
        { provide: WorkshopCheckInService, useValue: { get: getMock } },
        { provide: WorkshopCheckInMediaService, useValue: {} },
        { provide: WorkshopInspectionService, useValue: {} },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with JSON null and application/json when order has no check-in', async () => {
    getMock.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get(`/workshop/orders/${ORDER_ID}/check-in`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).toBe('null');
    expect(res.body).toBeNull();
  });

  it('returns 200 with the JSON payload when order has a check-in', async () => {
    const payload = {
      id: '22222222-2222-4222-8222-222222222222',
      workshop_order_id: ORDER_ID,
      status: 'DRAFT',
    } as WorkshopCheckInResponseDto;
    getMock.mockResolvedValue(payload);

    const res = await request(app.getHttpServer())
      .get(`/workshop/orders/${ORDER_ID}/check-in`)
      .expect(200);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual(payload);
  });

  it('returns 404 when the order is missing or in another tenant', async () => {
    getMock.mockRejectedValue(new NotFoundException('Workshop order not found'));

    await request(app.getHttpServer())
      .get(`/workshop/orders/${ORDER_ID}/check-in`)
      .expect(404);
  });

  it('returns 403 when the caller lacks permission', async () => {
    getMock.mockRejectedValue(new ForbiddenException('Forbidden'));

    await request(app.getHttpServer())
      .get(`/workshop/orders/${ORDER_ID}/check-in`)
      .expect(403);
  });
});
