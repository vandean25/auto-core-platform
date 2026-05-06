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

  // 1. Add AuthService import at the very top (after the first line to avoid messing up imports)
  if (!content.includes('AuthService')) {
    content = `import { AuthService } from '../src/auth/auth.service';\n` + content;
  }

  // 2. Add let authToken: string; right after let app: INestApplication
  if (!content.includes('let authToken: string;')) {
    content = content.replace(
      /(let app: INestApplication.*?;)/,
      `$1\n  let authToken: string;`
    );
  }

  // 3. Assign authToken in beforeAll
  if (content.includes('createTestTenant')) {
    // If it has a test tenant, find where tenant is created
    // We look for 'const testTenant = await createTestTenant(' or 'const tenant = await createTestTenant('
    const tenantRegex = /const (\w+) = await createTestTenant\([^)]*\);[\s\S]*?prisma = createTenantAwarePrisma\([^)]*\);/;
    const match = content.match(tenantRegex);
    if (match) {
      const tenantVar = match[1];
      content = content.replace(
        tenantRegex,
        `${match[0]}\n    authToken = app.get(AuthService).createTestToken({ tenantId: ${tenantVar}.tenantId });`
      );
    } else {
      // Fallback
      content = content.replace(
        /(await app\.init\(\);)/,
        `$1\n    authToken = app.get(AuthService).createTestToken();`
      );
    }
  } else {
    // No test tenant
    content = content.replace(
      /(await app\.init\(\);)/,
      `$1\n    authToken = app.get(AuthService).createTestToken();`
    );
  }

  // 4. Replace .set('x-api-key', 'test-api-key') with .set('Authorization', `Bearer ${authToken}`)
  content = content.replace(/\.set\('x-api-key',\s*'test-api-key'\)/g, "  .set('Authorization', `Bearer \\${authToken}`)");
  
  // 5. Replace wrong key
  content = content.replace(/\.set\('x-api-key',\s*'wrong-key'\)/g, "  .set('Authorization', `Bearer invalid-token`)");

  // 6. Fix the regexes for deleting old API_KEY logic
  const lines = content.split('\n');
  const newLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("process.env.API_KEY = 'test-api-key';")) continue;
    if (line.includes("let originalApiKey: string | undefined;")) continue;
    if (line.includes("originalApiKey = process.env.API_KEY;")) continue;
    if (line.includes("if (originalApiKey === undefined) delete process.env.API_KEY;")) continue;
    if (line.includes("else process.env.API_KEY = originalApiKey;")) continue;
    newLines.push(line);
  }
  content = newLines.join('\n');

  // Fix template literal issue
  content = content.replace(/Bearer \\\$authToken/g, "Bearer ${authToken}");

  fs.writeFileSync(file, content, 'utf8');
}
console.log('Migration complete.');
