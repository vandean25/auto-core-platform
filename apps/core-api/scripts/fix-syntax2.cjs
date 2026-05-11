const fs = require('fs');
const path = 'test/tenant-isolation-regression.e2e-spec.ts';
let lines = fs.readFileSync(path, 'utf8').split('\n');
if (lines[5].includes('teardownTestApp')) {
  const line = lines.splice(5, 1)[0];
  lines.splice(2, 0, line);
}
fs.writeFileSync(path, lines.join('\n'), 'utf8');
console.log('Fixed lines');
