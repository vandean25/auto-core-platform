import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { AuthService } from '../src/auth/auth.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';

jest.setTimeout(30000);

/** AUT-800: the e-mail of a customer is optional, so a form that sends "" must save the customer. */
describe('Customer with an empty e-mail (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let authToken: string;

  beforeAll(async () => {
    process.env.SECRET_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    const basePrisma = app.get<PrismaService>(PrismaService);
    const tenant = await createTestTenant(basePrisma, 'aut800');
    tenantId = tenant.tenantId;
    authToken = createTestAuthToken(app.get<AuthService>(AuthService), tenant);
    prisma = createTenantAwarePrisma(basePrisma, tenantId);
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenantId);
    await teardownTestApp(app);
  });

  const post = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post('/api/customers')
      .set('Authorization', `Bearer ${authToken}`)
      .send(body);

  it('creates a customer whose e-mail is an empty string, stored as no e-mail', async () => {
    const response = await post({
      type: 'PRIVATE',
      first_name: 'QA-r3',
      last_name: 'EmptyMail',
      email: '',
    }).expect(201);

    const stored = await prisma.customer.findFirst({
      where: { id: response.body.id as string, tenant_id: tenantId },
      select: { email: true },
    });
    expect(stored?.email).toBeNull();
  });

  it('creates a customer without the e-mail field and with a real e-mail', async () => {
    await post({ first_name: 'No', last_name: 'Field' }).expect(201);
    const response = await post({
      first_name: 'With',
      last_name: 'Mail',
      email: ' with.mail@example.com ',
    }).expect(201);
    expect(response.body.email).toBe('with.mail@example.com');
  });

  it('still refuses text that is not an e-mail, naming the field', async () => {
    const response = await post({
      first_name: 'Bad',
      last_name: 'Mail',
      email: 'not-an-email',
    }).expect(400);
    expect(response.body.message).toContain('email must be an email');
  });

  it('clears the e-mail of an existing customer with an empty string on update', async () => {
    const created = await post({
      first_name: 'Clear',
      last_name: 'Mail',
      email: 'clear.mail@example.com',
    }).expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/api/customers/${created.body.id as string}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ email: '' })
      .expect(200);
    expect(updated.body.email).toBeNull();
  });
});
