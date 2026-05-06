import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { teardownTestApp } from './test-lifecycle';

describe('Security (e2e)', () => {
  let app: INestApplication;
  let authToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    authToken = app.get(AuthService).createTestToken();
  });

  afterAll(async () => {
    await teardownTestApp(app);
  });

  it('should allow access with valid API key', () => {
    return request(app.getHttpServer())
      .get('/')
        .set('Authorization', `Bearer ${authToken}`)
      .expect(200);
  });

  it('should block access without API key', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  it('should block access with invalid API key', () => {
    return request(app.getHttpServer())
      .get('/')
        .set('Authorization', `Bearer invalid-token`)
      .expect(401);
  });
});
