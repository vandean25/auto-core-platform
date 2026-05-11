import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const e2eDir = path.join(__dirname, '../test');

const files = globSync(path.join(e2eDir, '**/*.e2e-spec.ts').replace(/\\/g, '/'));

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (!content.includes('x-api-key')) continue;

  console.log(`Processing ${path.basename(file)}`);

  // 1. Add import if missing
  if (!content.includes('AuthService')) {
    content = content.replace(
      /(import .* from '.*';\n)(?!import)/,
      `$1import { AuthService } from '../src/auth/auth.service';\n`
    );
  }

  // 2. Add let authToken: string; right after let app: INestApplication;
  if (!content.includes('let authToken: string;')) {
    content = content.replace(
      /(let app: INestApplication.*?;)/,
      `$1\n  let authToken: string;`
    );
  }

  // 3. Assign authToken in beforeAll
  if (content.includes('createTestTenant')) {
    // Has a test tenant
    content = content.replace(
      /(const testTenant = await createTestTenant\(.*?\);[\s\S]*?prisma = createTenantAwarePrisma\(.*?\);)/,
      `$1\n    authToken = app.get(AuthService).createTestToken({ tenantId: testTenant.tenantId });`
    );
  } else {
    // No test tenant
    content = content.replace(
      /(await app\.init\(\);)/,
      `$1\n    authToken = app.get(AuthService).createTestToken();`
    );
  }

  // 4. Replace .set('x-api-key', 'test-api-key') with .set('Authorization', `Bearer ${authToken}`)
  content = content.replace(/\.set\('x-api-key',\s*'test-api-key'\)/g, "  .set('Authorization', `Bearer ${authToken}`)");
  
  // 5. Replace wrong key
  content = content.replace(/\.set\('x-api-key',\s*'wrong-key'\)/g, "  .set('Authorization', `Bearer invalid-token`)");

  // 6. Remove process.env.API_KEY modifications
  content = content.replace(/process\.env\.API_KEY = 'test-api-key';/g, '');
  content = content.replace(/let originalApiKey: string \| undefined;/g, '');
  content = content.replace(/originalApiKey = process\.env\.API_KEY;/g, '');
  content = content.replace(/if \(originalApiKey === undefined\) delete process\.env\.API_KEY;\s*else process\.env\.API_KEY = originalApiKey;/g, '');
  content = content.replace(/if \(originalApiKey === undefined\) \{\s*delete process\.env\.API_KEY;\s*\} else \{\s*process\.env\.API_KEY = originalApiKey;\s*\}/g, '');

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Migration complete.');
