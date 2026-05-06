import { AuthService } from '../src/auth/auth.service';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { teardownTestApp } from './test-lifecycle';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let authToken: string;

  beforeAll(() => {
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    authToken = app.get(AuthService).createTestToken();
  });

  afterEach(async () => {
    await teardownTestApp(app);
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
        .set('Authorization', `Bearer \${authToken}`)
      .expect(200)
      .expect('Hello World!');
  });
});
