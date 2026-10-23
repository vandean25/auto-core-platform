import { loadSeedMasterCopy } from './seed-master-copy.js';

describe('seed-master-copy', () => {
  it('loads German annahme title from locales', () => {
    const bundle = loadSeedMasterCopy('de');
    expect(bundle.annahme.title.length).toBeGreaterThan(0);
  });
});
