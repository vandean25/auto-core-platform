import { SiteService } from './site.service.js';

describe('SiteService entry', () => {
  it('re-exports the runtime facade for Nest', () => {
    expect(SiteService).toBeDefined();
  });
});
