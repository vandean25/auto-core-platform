const fs = require('fs');
const path = 'test/tenant-isolation-regression.e2e-spec.ts';
let content = fs.readFileSync(path, 'utf8');
content = content.replace(
  "import {\r\nimport { teardownTestApp } from './test-lifecycle';\r\n  createTenantAwarePrisma,",
  "import { teardownTestApp } from './test-lifecycle';\r\nimport {\r\n  createTenantAwarePrisma,"
);
content = content.replace(
  "import {\nimport { teardownTestApp } from './test-lifecycle';\n  createTenantAwarePrisma,",
  "import { teardownTestApp } from './test-lifecycle';\nimport {\n  createTenantAwarePrisma,"
);
fs.writeFileSync(path, content, 'utf8');
console.log('Fixed');
