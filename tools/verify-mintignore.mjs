import { existsSync } from 'node:fs';

// The Mintlify content root is docs-site/ (moved from the repo root). App and
// infrastructure code no longer sits inside the content directory, which
// structurally prevents the CSS/JS leak regression guarded by AUT-205.
// The .mintignore file remains the content-root marker for Mintlify.
export const MINTIGNORE_PATH = 'docs-site/.mintignore';

export function assertMintignore(mintignorePath = MINTIGNORE_PATH) {
  if (!existsSync(mintignorePath)) {
    throw new Error(`${mintignorePath} is missing — keep the marker file at the Mintlify content root`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  assertMintignore();
  console.log('Mintlify .mintignore verification passed');
}
