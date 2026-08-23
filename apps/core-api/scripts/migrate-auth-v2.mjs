import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_API_KEY_ASSIGNMENT =
  /^[ \t]*process\.env\.API_KEY\s*=\s*['"`]test-api-key['"`];[ \t]*\r?\n/gm;
const ORIGINAL_API_KEY_DECLARATION =
  /^[ \t]*let\s+originalApiKey\s*:\s*string\s*\|\s*undefined;[ \t]*\r?\n/gm;
const ORIGINAL_API_KEY_SAVE =
  /^[ \t]*originalApiKey\s*=\s*process\.env\.API_KEY;[ \t]*\r?\n/gm;
const ORIGINAL_API_KEY_IF_ELSE =
  /^[ \t]*if\s*\(\s*originalApiKey\s*===\s*undefined\s*\)\s*\{?\s*\n?[ \t]*delete\s+process\.env\.API_KEY;\s*\n?[ \t]*\}?\s*(?:else\s*\{?\s*\n?[ \t]*process\.env\.API_KEY\s*=\s*originalApiKey;\s*\n?[ \t]*\}?)?[ \t]*\r?\n/gm;
const LEFTOVER_API_KEY_ELSE =
  /^[ \t]*\}?\s*else\s*\{?\s*\n?[ \t]*process\.env\.API_KEY\s*=\s*originalApiKey;\s*\n?[ \t]*\}?[ \t]*\r?\n/gm;
const TENANT_BOOTSTRAP =
  /const (\w+) = await createTestTenant\([^)]*\);[\s\S]*?prisma = createTenantAwarePrisma\([^)]*\);/;

export function transformE2eSpec(content) {
  if (!content.includes('x-api-key')) {
    return content;
  }

  if (!content.includes('AuthService')) {
    content =
      `import { AuthService } from '../src/auth/auth.service';\n` + content;
  }

  if (!content.includes('let authToken: string;')) {
    content = content.replace(
      /(let app: INestApplication.*?;)/,
      `$1\n  let authToken: string;`,
    );
  }

  if (content.includes('createTestTenant')) {
    const match = content.match(TENANT_BOOTSTRAP);
    if (match) {
      const tenantVar = match[1];
      content = content.replace(
        TENANT_BOOTSTRAP,
        `${match[0]}\n    authToken = app.get(AuthService).createTestToken({ tenantId: ${tenantVar}.tenantId });`,
      );
    } else {
      content = content.replace(
        /(await app\.init\(\);)/,
        `$1\n    authToken = app.get(AuthService).createTestToken();`,
      );
    }
  } else {
    content = content.replace(
      /(await app\.init\(\);)/,
      `$1\n    authToken = app.get(AuthService).createTestToken();`,
    );
  }

  content = content.replace(/\.set\('x-api-key',\s*'test-api-key'\)/g, () =>
    ".set('Authorization', `Bearer ${authToken}`)",
  );
  content = content.replace(
    /\.set\('x-api-key',\s*'wrong-key'\)/g,
    ".set('Authorization', `Bearer invalid-token`)",
  );

  content = content.replace(TEST_API_KEY_ASSIGNMENT, '');
  content = content.replace(ORIGINAL_API_KEY_DECLARATION, '');
  content = content.replace(ORIGINAL_API_KEY_SAVE, '');
  content = content.replace(ORIGINAL_API_KEY_IF_ELSE, '');
  content = content.replace(LEFTOVER_API_KEY_ELSE, '');

  return content;
}

function migrateE2eSpecs(e2eDir) {
  const files = fs
    .globSync('**/*.e2e-spec.ts', { cwd: e2eDir })
    .map((relativePath) => path.join(e2eDir, relativePath));

  for (const file of files) {
    const original = fs.readFileSync(file, 'utf8');
    const updated = transformE2eSpec(original);
    if (updated === original) {
      continue;
    }
    console.log(`Processing ${path.basename(file)}`);
    fs.writeFileSync(file, updated, 'utf8');
  }

  console.log('Migration complete.');
}

function runCli(argv, stdin) {
  if (argv.includes('--stdin')) {
    process.stdout.write(transformE2eSpec(stdin));
    return;
  }

  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  migrateE2eSpecs(path.join(scriptDir, '../test'));
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const stdin = process.argv.includes('--stdin')
    ? fs.readFileSync(0, 'utf8')
    : '';
  runCli(process.argv.slice(2), stdin);
}
