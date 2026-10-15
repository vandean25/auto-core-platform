/** Test and fake-provider marker embedded after valid image magic bytes. */
export const REGINTAKE_FIXTURE_PREFIX = 'REGINTAKE_FIXTURE:';

export function encodeRegistrationIntakeFixtureBytes(
  fixtureId: string,
  mime: 'image/jpeg' | 'image/png' | 'application/pdf' = 'image/jpeg',
): Buffer {
  const marker = Buffer.from(`${REGINTAKE_FIXTURE_PREFIX}${fixtureId}`, 'utf8');
  if (mime === 'image/jpeg') {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), marker]);
  }
  if (mime === 'application/pdf') {
    return Buffer.concat([Buffer.from('%PDF-1.4\n'), marker]);
  }
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  return Buffer.concat([pngSignature, marker]);
}

export function readRegistrationIntakeFixtureId(bytes: Buffer): string | null {
  const text = bytes.toString('utf8');
  const index = text.indexOf(REGINTAKE_FIXTURE_PREFIX);
  if (index < 0) {
    return null;
  }
  const rest = text.slice(index + REGINTAKE_FIXTURE_PREFIX.length);
  const match = /^[a-z0-9-]+/.exec(rest);
  return match?.[0] ?? null;
}
