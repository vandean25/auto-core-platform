import { seedE2eFullstackFixture } from './e2e-fullstack/seed-fixture.js';

describe('e2e-fullstack seed harness', () => {
  it('writes the Playwright fixture file', async () => {
    await seedE2eFullstackFixture();
  });
});
