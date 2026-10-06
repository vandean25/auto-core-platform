import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../test/fixtures/agent-eval');

const FIRST_NAMES = ['Max', 'Erika', 'Hans', 'Lieschen', 'Fritz', 'Greta'];
const LAST_NAMES = ['Mustermann', 'Musterfrau', 'Beispiel', 'Probe', 'Testmann'];
const CITIES = ['Musterstadt', 'Beispielhausen', 'Demodorf', 'Fixhausen'];
const DOC_SNIPPETS = {
  Rechnung: [
    'Rechnung Nr. DEMO-2026-0001 an Musterkunde Mustermann',
    'USt-IdNr. DE999999999 Rechnungsdatum 01.01.2026',
  ],
  Lieferschein: [
    'Lieferschein LS-DEMO-42 Teilelieferung Werkstatt',
    'Versand an Beispielstraße 1 Musterstadt',
  ],
  Kostenvoranschlag: [
    'Kostenvoranschlag KVA-DEMO-7 Reparatur Bremsen',
    'Angebot gültig 14 Tage Musterfahrzeug',
  ],
  Fahrzeugschein: [
    'Zulassungsbescheinigung Teil I FIN DEMO0000000000001',
    'Fahrzeugschein Kennzeichen M-XX 9999',
  ],
  Sonstiges: [
    'Allgemeine Notiz ohne Dokumenttyp',
    'Werkstattinterne Memo DEMO nur Test',
  ],
};

const DIFFICULTIES = ['easy', 'ambiguous', 'adversarial'];

function pick(list, index) {
  return list[index % list.length];
}

function makeImportExample(index) {
  const falseCompletion = index % 17 === 0;
  const difficulty = falseCompletion
    ? 'adversarial'
    : pick(DIFFICULTIES, index);
  const first = pick(FIRST_NAMES, index);
  const last = pick(LAST_NAMES, index + 1);
  const city = pick(CITIES, index);
  const candidateA = `cand-a-${index}`;
  const candidateB = `cand-b-${index}`;
  const entityType = index % 2 === 0 ? 'customer' : 'vehicle';
  const identityKind = index % 4;
  const matchesCandidate = !falseCompletion && index % 7 !== 5;
  const label = matchesCandidate ? candidateA : '__create_new__';
  const row =
    entityType === 'customer'
      ? {
          external_id: `EXT-DEMO-${index}`,
          type: 'PRIVATE',
          first_name: first,
          last_name: last,
          email: `demo-${index}@example.org`,
          phone: '000-000-0000',
          address_city: city,
          address_country: 'DE',
        }
      : {
          external_id: `EXT-DEMO-${index}`,
          vin: identityKind === 1 ? `DEM0${String(index).padStart(13, '0')}` : '',
          plate: `DEMO-${String(index).padStart(4, '0')}`,
          make: 'Beispiel',
          model: 'Testwagen',
          year: '2020',
        };
  const candidateARecord =
    entityType === 'customer'
      ? {
          ...(identityKind === 0 && matchesCandidate
            ? { external_id: row.external_id }
            : {}),
          email:
            identityKind === 2 && matchesCandidate
              ? row.email
              : `candidate-${index}@example.org`,
        }
      : {
          ...(identityKind === 1 && matchesCandidate
            ? { vin: row.vin }
            : { vin: `DEM0${String(index + 1000).padStart(13, '0')}` }),
          ...(identityKind === 3 && matchesCandidate
            ? { plate: row.plate }
            : { plate: `OTHER-${String(index).padStart(4, '0')}` }),
        };
  const completionClaim = falseCompletion
    ? { done: true, choice: candidateA }
    : undefined;
  return {
    id: `import-${String(index).padStart(3, '0')}`,
    use_case: 'import_row_matching',
    difficulty,
    label,
    choices: [candidateA, candidateB, '__create_new__'],
    ...(falseCompletion
      ? { tags: ['false_completion'], completion_claim: completionClaim }
      : {}),
    input: {
      entity_type: entityType,
      row,
      candidates: [
        {
          id: candidateA,
          label: `${first} ${last} (${city})`,
          ...candidateARecord,
        },
        {
          id: candidateB,
          label: `${first} ${last} Alt`,
          email: `other-${index}@example.org`,
          vin: `DEM0${String(index + 2000).padStart(13, '0')}`,
          plate: `OTHER-${String(index + 1000).padStart(4, '0')}`,
        },
      ],
    },
  };
}

function makeDocumentExample(index) {
  const types = Object.keys(DOC_SNIPPETS);
  const falseCompletion = index % 17 === 0;
  const type = pick(types, index);
  const difficulty = falseCompletion
    ? 'adversarial'
    : pick(DIFFICULTIES, index + 1);
  const snippets = DOC_SNIPPETS[type];
  const base = pick(snippets, index);
  const text =
    falseCompletion
      ? `${base} Rechnung Lieferschein gemischt DEMO`
      : difficulty === 'adversarial'
      ? `${base} Rechnung Lieferschein gemischt DEMO`
      : base;
  const label = falseCompletion ? 'Sonstiges' : type;
  return {
    id: `doc-${String(index).padStart(3, '0')}`,
    use_case: 'document_sort',
    difficulty,
    label,
    choices: [
      'Rechnung',
      'Lieferschein',
      'Kostenvoranschlag',
      'Fahrzeugschein',
      'Sonstiges',
    ],
    ...(falseCompletion
      ? {
          tags: ['false_completion'],
          completion_claim: { done: true, choice: 'Rechnung' },
        }
      : {}),
    input: { text },
  };
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const lines = [];
  for (let i = 0; i < 100; i += 1) {
    lines.push(JSON.stringify(makeImportExample(i)));
  }
  for (let i = 0; i < 100; i += 1) {
    lines.push(JSON.stringify(makeDocumentExample(i)));
  }
  const body = `${lines.join('\n')}\n`;
  const path = join(outDir, 'labeled-examples.jsonl');
  writeFileSync(path, body, 'utf8');
  const digest = createHash('sha256').update(body).digest('hex');
  writeFileSync(
    join(outDir, 'labeled-examples.sha256'),
    `${digest}  labeled-examples.jsonl\n`,
    'utf8',
  );
  console.log(`Wrote ${lines.length} examples to ${path}`);
}

main();
