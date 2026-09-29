import {
  createDocumentBrandingVisualFixtures,
  createTransparentLogoPng,
} from './document-branding-visual-fixtures.js';

describe('document branding visual fixtures', () => {
  it('covers each required invoice and branding variant', () => {
    const fixtures = createDocumentBrandingVisualFixtures();

    expect(fixtures.some((fixture) => fixture.id === 'at-default')).toBe(true);
    expect(fixtures.some((fixture) => fixture.id === 'de-default')).toBe(true);
    expect(
      fixtures.some(
        (fixture) =>
          fixture.country === 'AT' &&
          fixture.taxProfile === 'standard' &&
          fixture.branded,
      ),
    ).toBe(true);
    expect(
      fixtures.some(
        (fixture) =>
          fixture.country === 'DE' &&
          fixture.taxProfile === 'standard' &&
          fixture.branded,
      ),
    ).toBe(true);
    expect(
      fixtures.some(
        (fixture) =>
          fixture.country === 'DE' &&
          fixture.taxProfile === 'margin' &&
          fixture.itemCount >= 100,
      ),
    ).toBe(true);
  });

  it('covers long decorative and legal text with transparent logos of each aspect ratio', () => {
    const fixtures = createDocumentBrandingVisualFixtures();
    const decoratedFixture = fixtures.find(
      (fixture) => fixture.decorativeTextLength === 120,
    );
    const legalFixture = fixtures.find((fixture) => fixture.longLegalFields);
    const logoDimensions = fixtures
      .map((fixture) => fixture.logo)
      .filter((logo) => logo !== null)
      .map(({ width, height }) => width / height);

    expect(decoratedFixture).toBeDefined();
    expect(legalFixture).toBeDefined();
    expect(new Set(logoDimensions)).toEqual(
      new Set([1, 1 / 3, 3]),
    );
  });

  it('covers all nine header and footer band combinations', () => {
    const bandPairs = createDocumentBrandingVisualFixtures()
      .filter((fixture) => fixture.bandMatrixCase)
      .map((fixture) => `${fixture.headerBand}:${fixture.footerBand}`);

    expect(new Set(bandPairs)).toEqual(
      new Set(
        ['none', 'primary', 'secondary'].flatMap((header) =>
          ['none', 'primary', 'secondary'].map(
            (footer) => `${header}:${footer}`,
          ),
        ),
      ),
    );
  });

  it.each([
    { width: 160, height: 160 },
    { width: 120, height: 360 },
    { width: 360, height: 120 },
  ])('creates a transparent $width × $height PNG logo', async ({ width, height }) => {
    const png = await createTransparentLogoPng({ width, height });

    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
    expect(png.readUInt8(25)).toBe(6);
    expect(png.toString('ascii', 1, 4)).toBe('PNG');
  });
});
