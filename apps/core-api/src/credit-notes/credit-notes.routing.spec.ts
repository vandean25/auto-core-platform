import { Controller, Get, Module, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

@Controller('credit-notes')
class RoutingProbeController {
  @Get(':id')
  findOne(@Param('id') id: string) {
    return { handler: 'findOne', id };
  }

  @Get(':id/pdf')
  getPdf(@Param('id') id: string) {
    return { handler: 'getPdf', id };
  }
}

@Module({ controllers: [RoutingProbeController] })
class RoutingProbeModule {}

describe('CreditNotesController route matching', () => {
  it('routes GET /credit-notes/:id/pdf to getPdf, not findOne', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [RoutingProbeModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    await app.init();

    const response = await request(app.getHttpServer()).get(
      '/credit-notes/1c67f3ba-b2b4-4a93-a81f-1f004e9a4258/pdf',
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      handler: 'getPdf',
      id: '1c67f3ba-b2b4-4a93-a81f-1f004e9a4258',
    });

    await app.close();
  });
});
