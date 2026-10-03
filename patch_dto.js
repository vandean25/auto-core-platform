const fs = require('fs');

// apps/core-api/src/vehicle/dto/pickerl-due-list.dto.ts
let content = fs.readFileSync('apps/core-api/src/vehicle/dto/pickerl-due-list.dto.ts', 'utf-8');

if (!content.includes('last_inspected_on?: Date | null')) {
  // Update PaginatedResponse if necessary, though it might not need typing here
}
