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
      expect(response.headers['referrer-policy']).toBe(
        'no-referrer',
      );
      expect(response.headers['content-security-policy']).toBeUndefined();
      expect(
        (
          app.getHttpAdapter().getInstance() as {
            get(name: string): unknown;
          }
        ).get('trust proxy'),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it('accepts comma-separated frontend origins for HTTP CORS', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    const app = moduleRef.createNestApplication();

    configureHttpSecurity(app, {
      frontendUrl: 'https://app.example.com,https://admin.example.com',
      nodeEnv: 'test',
    });
    await app.init();

    try {
      const response = await request(app.getHttpServer())
        .options('/health')
        .set('Origin', 'https://admin.example.com')
        .set('Access-Control-Request-Method', 'GET');

      expect(response.status).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe(
        'https://admin.example.com',
      );
    } finally {
      await app.close();
    }
  });
});
