import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHECK_IN_ZONE_IDS } from './workshop-check-in-zones.js';

describe('workshop check-in vehicle sketch zones', () => {
  it('lists every interactive SVG zone id in sketch_version 1', () => {
    const svgPath = join(
      process.cwd(),
      '..',
      'core-web',
      'src',
      'features',
      'workshop',
      'check-in',
      'assets',
      'check-in-vehicle-sketch-v1.svg',
    );
    const svg = readFileSync(svgPath, 'utf8');
    const sketchZoneIds = CHECK_IN_ZONE_IDS.filter((id) => id !== 'OTHER');
    for (const zoneId of sketchZoneIds) {
      expect(svg).toContain(`id="${zoneId}"`);
    }
  });
});
