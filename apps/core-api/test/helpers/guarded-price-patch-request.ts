import request from 'supertest';
import type { INestApplication } from '@nestjs/common';

export function guardedPricePatchRequest(
  app: INestApplication,
  itemId: string,
  key: string,
  body: { retail_price: number; expectedRevision: number },
  auth = 'Bearer unused',
) {
  return request(app.getHttpServer())
    .patch(`/api/inventory/${itemId}`)
    .set('Authorization', auth)
    .set('Idempotency-Key', key)
    .send(body);
}
