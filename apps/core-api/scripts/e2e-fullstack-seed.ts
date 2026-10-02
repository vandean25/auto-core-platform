import { seedE2eFullstackFixture } from '../test/e2e-fullstack/seed-fixture.js';

const fixture = await seedE2eFullstackFixture();
console.log(
  `[e2e-fullstack] Seeded tenant ${fixture.tenantId} and wrote auth fixture.`,
);
