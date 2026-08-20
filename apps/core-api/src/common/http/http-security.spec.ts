import { Controller, Get, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureHttpSecurity } from './http-security';

@Controller('health')
class HealthController {
  @Get()
  getHealth() {
    return { ok: true };
  }
}

@Module({ controllers: [HealthController] })
class HealthModule {}

describe('configureHttpSecurity', () => {
  it('adds production Helmet headers without API CSP', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    configureHttpSecurity(app, {
      frontendUrl: 'https://app.example.com',
      nodeEnv: 'production',
    });
    await app.init();

    try {
      const response = await request(app.getHttpServer()).get('/health');

      expect(response.status).toBe(200);
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(response.headers['content-security-policy']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});
