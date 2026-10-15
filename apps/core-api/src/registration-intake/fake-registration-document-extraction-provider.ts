import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RegistrationDocumentExtractionProvider } from './registration-document-extraction-provider.js';
import { REGISTRATION_DOCUMENT_PROMPT_VERSION } from './registration-document-extraction.types.js';
import { readRegistrationIntakeFixtureId } from './registration-intake-fixture-bytes.js';

type FixtureFile = {
  extractions: Record<
    string,
    {
      documentKind: string;
      warnings: string[];
      fields: Record<string, unknown>;
    }
  >;
};

let cachedFixtures: FixtureFile | null = null;

function loadFixtures(): FixtureFile {
  if (cachedFixtures) {
    return cachedFixtures;
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturePath = join(
    here,
    '../../test/fixtures/registration-document-intake.fixtures.json',
  );
  cachedFixtures = JSON.parse(readFileSync(fixturePath, 'utf8')) as FixtureFile;
  return cachedFixtures;
}

export class FakeRegistrationDocumentExtractionProvider implements RegistrationDocumentExtractionProvider {
  isAvailable(): boolean {
    return true;
  }

  getMetadata(): { providerId: string; modelId: string } {
    return { providerId: 'fake', modelId: 'fixture' };
  }

  async extract(input: {
    pages: { page: number; png: Buffer }[];
    promptVersion: typeof REGISTRATION_DOCUMENT_PROMPT_VERSION;
    signal: AbortSignal;
  }) {
    if (input.promptVersion !== REGISTRATION_DOCUMENT_PROMPT_VERSION) {
      throw new Error(`Unsupported prompt version ${input.promptVersion}`);
    }
    input.signal.throwIfAborted();
    const fixtures = loadFixtures();
    const fixtureIds = input.pages
      .map((page) => readRegistrationIntakeFixtureId(page.png))
      .filter((id): id is string => Boolean(id));
    const uniqueIds = [...new Set(fixtureIds)];
    const ids = uniqueIds.length > 0 ? uniqueIds : ['illegible'];
    const rows = ids.map(
      (id) => fixtures.extractions[id] ?? fixtures.extractions.illegible,
    );
    const documentKind = rows[rows.length - 1]?.documentKind ?? 'UNKNOWN';
    const warnings = [...new Set(rows.flatMap((row) => row.warnings))] as Array<
      'WRONG_DOCUMENT' | 'ILLEGIBLE' | 'EXTRA_PAGES_IGNORED' | 'BACK_NOT_SUPPLIED'
    >;
    const fields = rows.reduce<Record<string, unknown>>((acc, row) => {
      return { ...acc, ...row.fields };
    }, {});
    return {
      documentKind: documentKind as
        | 'AT_ZULASSUNGSSCHEIN'
        | 'DE_ZB_I'
        | 'OTHER'
        | 'UNKNOWN',
      warnings,
      fields: fields as Record<
        string,
        import('./registration-document-extraction.types.js').RegistrationFieldEvidence
      >,
    };
  }
}
