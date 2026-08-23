import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const SCRIPT = path.join(__dirname, 'migrate-auth-v2.mjs');

function transformE2eSpec(source: string): string {
  return execFileSync(process.execPath, [SCRIPT, '--stdin'], {
    encoding: 'utf8',
    input: source,
  });
}

describe('migrate-auth-v2 transform', () => {
  it('writes a Bearer header that interpolates authToken', () => {
    const output = transformE2eSpec(`
describe('sample', () => {
  let app: INestApplication;
  beforeAll(async () => {
    await app.init();
  });
  it('ok', () => {
    return request(app.getHttpServer()).get('/x').set('x-api-key', 'test-api-key');
  });
});
`);

    expect(output).toContain('.set(\'Authorization\', `Bearer ${authToken}`)');
    expect(output).not.toContain('\\${authToken}');
  });

  it('replaces the wrong-key header with an invalid bearer token', () => {
    const output = transformE2eSpec(
      `request(app.getHttpServer()).get('/x').set('x-api-key', 'wrong-key');\n`,
    );

    expect(output).toContain(
      ".set('Authorization', `Bearer invalid-token`)",
    );
  });

  it('removes a multiline originalApiKey if/else without leftover braces', () => {
    const output = transformE2eSpec(`
    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }
    .set('x-api-key', 'test-api-key');
`);

    expect(output).not.toMatch(/originalApiKey/);
    expect(output).not.toMatch(/process\.env\.API_KEY/);
    expect(output).not.toMatch(/^\s*\} else \{/m);
  });

  it('removes a single-line originalApiKey if/else', () => {
    const output = transformE2eSpec(`
    if (originalApiKey === undefined) delete process.env.API_KEY;
    else process.env.API_KEY = originalApiKey;
    .set('x-api-key', 'test-api-key');
`);

    expect(output).not.toMatch(/originalApiKey/);
    expect(output).not.toMatch(/process\.env\.API_KEY/);
  });

  it('removes a leftover else block from a prior partial run', () => {
    const output = transformE2eSpec(`
    } else {
      process.env.API_KEY = originalApiKey;
    }
    .set('x-api-key', 'test-api-key');
`);

    expect(output).not.toMatch(/originalApiKey/);
    expect(output).not.toMatch(/process\.env\.API_KEY/);
    expect(output).not.toMatch(/\} else \{/);
  });

  it('strips originalApiKey declaration, save, and test-api-key assignment', () => {
    const output = transformE2eSpec(`
    let originalApiKey: string | undefined;
    originalApiKey = process.env.API_KEY;
    process.env.API_KEY = 'test-api-key';
    .set('x-api-key', 'test-api-key');
`);

    expect(output).not.toMatch(/originalApiKey/);
    expect(output).not.toMatch(/process\.env\.API_KEY/);
  });

  it('adds an AuthService import and authToken when createTestTenant is present', () => {
    const output = transformE2eSpec(`
import { INestApplication } from '@nestjs/common';

describe('sample', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const testTenant = await createTestTenant(prisma);
    prisma = createTenantAwarePrisma(testTenant.tenantId);
    await app.init();
  });
  it('ok', () => {
    return request(app.getHttpServer()).get('/x').set('x-api-key', 'test-api-key');
  });
});
`);

    expect(output).toContain(
      "import { AuthService } from '../src/auth/auth.service';",
    );
    expect(output).toContain('let authToken: string;');
    expect(output).toContain(
      'authToken = app.get(AuthService).createTestToken({ tenantId: testTenant.tenantId });',
    );
  });

  it('leaves files without x-api-key unchanged', () => {
    const source = `describe('untouched', () => {\n  it('ok', () => undefined);\n});\n`;

    expect(transformE2eSpec(source)).toBe(source);
  });
});
