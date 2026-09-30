import sharp from 'sharp';

export type VisualLogo = {
  width: number;
  height: number;
};

export type VisualFixture = {
  id: string;
  country: 'AT' | 'DE';
  taxProfile: 'standard' | 'margin';
  itemCount: number;
  branded: boolean;
  headerBand: 'none' | 'primary' | 'secondary';
  footerBand: 'none' | 'primary' | 'secondary';
  decorativeTextLength: number;
  longLegalFields: boolean;
  bandMatrixCase: boolean;
  logo: VisualLogo | null;
};

const bandValues: VisualFixture['headerBand'][] = [
  'none',
  'primary',
  'secondary',
];

export function createDocumentBrandingVisualFixtures(): VisualFixture[] {
  const requiredCases: VisualFixture[] = [
    {
      id: 'at-default',
      country: 'AT',
      taxProfile: 'standard',
      itemCount: 1,
      branded: false,
      headerBand: 'none',
      footerBand: 'none',
      decorativeTextLength: 0,
      longLegalFields: false,
      bandMatrixCase: false,
      logo: null,
    },
    {
      id: 'de-default',
      country: 'DE',
      taxProfile: 'standard',
      itemCount: 1,
      branded: false,
      headerBand: 'none',
      footerBand: 'none',
      decorativeTextLength: 0,
      longLegalFields: false,
      bandMatrixCase: false,
      logo: null,
    },
    {
      id: 'at-standard-square-logo',
      country: 'AT',
      taxProfile: 'standard',
      itemCount: 1,
      branded: true,
      headerBand: 'primary',
      footerBand: 'secondary',
      decorativeTextLength: 120,
      longLegalFields: true,
      bandMatrixCase: false,
      logo: { width: 160, height: 160 },
    },
    {
      id: 'de-standard-tall-logo-ten-pages',
      country: 'DE',
      taxProfile: 'standard',
      itemCount: 100,
      branded: true,
      headerBand: 'primary',
      footerBand: 'secondary',
      decorativeTextLength: 120,
      longLegalFields: true,
      bandMatrixCase: false,
      logo: { width: 120, height: 360 },
    },
    {
      id: 'de-margin-wide-logo-ten-pages',
      country: 'DE',
      taxProfile: 'margin',
      itemCount: 100,
      branded: true,
      headerBand: 'secondary',
      footerBand: 'primary',
      decorativeTextLength: 120,
      longLegalFields: true,
      bandMatrixCase: false,
      logo: { width: 360, height: 120 },
    },
  ];

  const bandMatrix = bandValues.flatMap((headerBand) =>
    bandValues.map((footerBand) => ({
      id: `at-bands-${headerBand}-${footerBand}`,
      country: 'AT' as const,
      taxProfile: 'standard' as const,
      itemCount: 1,
      branded: true,
      headerBand,
      footerBand,
      decorativeTextLength: 0,
      longLegalFields: false,
      bandMatrixCase: true,
      logo: null,
    })),
  );

  return [...requiredCases, ...bandMatrix];
}

export async function createTransparentLogoPng({
  width,
  height,
}: VisualLogo): Promise<Buffer> {
  const logoShape = Buffer.from(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg"><rect x="${Math.round(width * 0.2)}" y="${Math.round(height * 0.2)}" width="${Math.round(width * 0.6)}" height="${Math.round(height * 0.6)}" rx="${Math.round(Math.min(width, height) * 0.1)}" fill="#334155"/></svg>`,
  );

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: 'rgba(0, 0, 0, 0)',
    },
  })
    .composite([{ input: logoShape }])
    .png()
    .toBuffer();
}
