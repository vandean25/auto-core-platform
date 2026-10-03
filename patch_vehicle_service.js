const fs = require('fs');

let content = fs.readFileSync('apps/core-api/src/vehicle/vehicle.service.ts', 'utf-8');

// Replace the mapping in getPickerlDueData to preserve last_inspected_on
content = content.replace(
  /\.map\(\(v\) => attachPickerlDue\(v, today\)\)/,
  `.map((v) => {
        const last_inspected_on = v.inspection_records?.[0]?.inspected_on ?? null;
        const attached = attachPickerlDue(v, today);
        return { ...attached, last_inspected_on };
      })`
);

// Update exportPickerlDueCsv to use row.last_inspected_on
content = content.replace(
  /const records = row as unknown as {[\s\S]*?};\n\s*const lastInspectionDate = records\.inspection_records\?\.\[0\]\?\.inspected_on;\n\s*const lastInspectionStr = lastInspectionDate\n\s*\?\s*lastInspectionDate\.toISOString\(\)\.split\('T'\)\[0\]\n\s*:\s*'';/,
  `const lastInspectionDate = row.last_inspected_on;
      const lastInspectionStr = lastInspectionDate
        ? lastInspectionDate.toISOString().split('T')[0]
        : '';`
);

fs.writeFileSync('apps/core-api/src/vehicle/vehicle.service.ts', content);
