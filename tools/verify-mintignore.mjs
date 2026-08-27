import { readFileSync } from 'node:fs';

export const REQUIRED_MINTIGNORE_PATTERNS = ['apps/', 'infra/', 'tools/', 'docs/internal/'];

export function assertMintignore(mintignorePath = '.mintignore') {
  const mintignore = readFileSync(mintignorePath, 'utf8');
  const missing = REQUIRED_MINTIGNORE_PATTERNS.filter((pattern) => !mintignore.includes(pattern));
  if (missing.length > 0) {
    throw new Error(`.mintignore is missing required patterns: ${missing.join(', ')}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertMintignore();
  console.log('Mintlify .mintignore verification passed');
}
