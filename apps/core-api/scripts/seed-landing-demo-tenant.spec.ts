import { loadSeedMasterCopy } from '../src/prisma/fixtures/seed-master-copy.js';

describe('seed-landing-demo-tenant master copy', () => {
  it('uses English master data for the landing demo tenant', () => {
    const en = loadSeedMasterCopy('en');
    expect(en.landingDemo.tenantName).toBe('Demo Workshop Alpenblick');
    expect(en.pickerl.title).toMatch(/preparation/i);
    expect(en.pickerl.items.LIGHTS).toBe('Lighting');
    expect(en.annahme.title).toBe('Vehicle intake check');
    expect(en.landingDemo.storage.TRANSIT).toBe('In transit');
  });

  it('keeps German master data separate for the default workshop seed', () => {
    const de = loadSeedMasterCopy('de');
    expect(de.pickerl.items.LIGHTS).toBe('Beleuchtung');
    expect(de.annahme.title).toBe('Annahme-Check');
  });
});
