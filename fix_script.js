const fs = require('fs');
let code = fs.readFileSync('apps/core-api/scripts/migrate-auth-v2.mjs', 'utf8');

const replacementCode = `  // 6. Fix the regexes for deleting old API_KEY logic
  content = content.replace(/^[ \\t]*process\\.env\\.API_KEY\\s*=\\s*['"\`]test-api-key['"\`];[ \\t]*\\r?\\n/gm, '');
  content = content.replace(/^[ \\t]*let\\s+originalApiKey\\s*:\\s*string\\s*\\|\\s*undefined;[ \\t]*\\r?\\n/gm, '');
  content = content.replace(/^[ \\t]*originalApiKey\\s*=\\s*process\\.env\\.API_KEY;[ \\t]*\\r?\\n/gm, '');
  content = content.replace(/^[ \\t]*if\\s*\\(\\s*originalApiKey\\s*===\\s*undefined\\s*\\)\\s*\\{?\\s*\\n?[ \\t]*delete\\s+process\\.env\\.API_KEY;\\s*\\n?[ \\t]*\\}?\\s*(?:else\\s*\\{?\\s*\\n?[ \\t]*process\\.env\\.API_KEY\\s*=\\s*originalApiKey;\\s*\\n?[ \\t]*\\}?)?[ \\t]*\\r?\\n/gm, '');`;

const searchRegex = /\/\/ 6\. Fix the regexes for deleting old API_KEY logic[\s\S]*?(?=\/\/ Fix template literal issue)/;

code = code.replace(searchRegex, replacementCode + '\n\n  ');

fs.writeFileSync('apps/core-api/scripts/migrate-auth-v2.mjs', code, 'utf8');
