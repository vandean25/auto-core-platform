import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { createGlobalValidationPipe } from '../src/common/index.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AuthService } from '../src/auth/auth.service.js';
import {
  cleanupTestTenantGraph,
  createTenantAwarePrisma,
  createTestAuthToken,
  createTestTenant,
} from './tenant-test-utils.js';
import { teardownTestApp } from './test-lifecycle.js';
import { serializeCsv } from '../src/import/csv-parse.util.js';
import { DECISION_PROVIDER_TOKEN } from '../src/decision/decision.constants.js';

describe('Decision shadow mode (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let authService: AuthService;
  let tenant: Awaited<ReturnType<typeof createTestTenant>>;
  let authHeader: string;
  const decide = jest.fn();

  const customerMapping = {
    external_id: 'Kunden-Nr',
    type: 'Typ',
    first_name: 'Vorname',
    last_name: 'Nachname',
    email: 'E-Mail',
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(DECISION_PROVIDER_TOKEN)
      .useValue({ providerId: 'openrouter-jev', decide })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(createGlobalValidationPipe());
    await app.init();

    prisma = app.get(PrismaService);
    authService = app.get(AuthService);
    tenant = await createTestTenant(prisma, 'decision-shadow');
    authHeader = `Bearer ${createTestAuthToken(authService, tenant)}`;
  });

  afterAll(async () => {
    await cleanupTestTenantGraph(prisma, tenant.tenantId);
    await teardownTestApp(app, prisma);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.DECISION_SHADOW_ENABLED;
    delete process.env.DECISION_PROVIDER;
  });

  function customerCsv(rows: string[][]) {
    const headers = ['Kunden-Nr', 'Typ', 'Vorname', 'Nachname', 'E-Mail'];
    return Buffer.from(serializeCsv(headers, rows, ';'), 'utf8');
  }

  it('does not call provider when shadow is disabled', async () => {
    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach(
        'file',
        customerCsv([
          ['9200', 'PRIVATE', 'Max', 'Mustermann', 'max@example.org'],
        ]),
        'customers.csv',
      )
      .expect(201);

    expect(decide).not.toHaveBeenCalled();
  });

  it('returns 201 when shadow provider fails', async () => {
    process.env.DECISION_SHADOW_ENABLED = 'true';
    let notifyProviderCalled!: () => void;
    const providerCalled = new Promise<void>((resolve) => {
      notifyProviderCalled = resolve;
    });
    decide.mockImplementation(() => {
      notifyProviderCalled();
      return Promise.reject(new Error('provider down'));
    });

    await createTenantAwarePrisma(prisma, tenant.tenantId).customer.create({
      data: {
        tenant_id: tenant.tenantId,
        first_name: 'Erika',
        last_name: 'Mustermann',
        email: 'existing-erika@example.org',
      },
    });

    await request(app.getHttpServer())
      .post('/imports')
      .set('Authorization', authHeader)
      .field('entityType', 'CUSTOMER')
      .field('sourceSystem', 'legacy-dms')
      .field('mapping', JSON.stringify(customerMapping))
      .attach(
        'file',
        customerCsv([
          ['9201', 'PRIVATE', 'Erika', 'Mustermann', 'erika@example.org'],
        ]),
        'customers.csv',
      )
      .expect(201);

    await providerCalled;
    expect(decide).toHaveBeenCalled();
  });
});
