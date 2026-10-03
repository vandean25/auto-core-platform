import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '../test/fixtures/agent-eval');

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
  const difficulty = pick(DIFFICULTIES, index);
  const first = pick(FIRST_NAMES, index);
  const last = pick(LAST_NAMES, index + 1);
  const city = pick(CITIES, index);
  const candidateA = `cand-a-${index}`;
  const candidateB = `cand-b-${index}`;
  const label = index % 3 === 0 ? '__create_new__' : candidateA;
  return {
    id: `import-${String(index).padStart(3, '0')}`,
    use_case: 'import_row_matching',
    difficulty,
    label,
    choices: [candidateA, candidateB, '__create_new__'],
    input: {
      row: {
        external_id: `EXT-DEMO-${index}`,
        type: 'PRIVATE',
        first_name: first,
        last_name: last,
        email: `demo-${index}@example.org`,
        phone: '000-000-0000',
        address_city: city,
        address_country: 'DE',
      },
      candidates: [
        { id: candidateA, label: `${first} ${last} (${city})` },
        { id: candidateB, label: `${first} ${last} Alt` },
      ],
    },
  };
}

function makeDocumentExample(index) {
  const types = Object.keys(DOC_SNIPPETS);
  const type = pick(types, index);
  const difficulty = pick(DIFFICULTIES, index + 1);
  const snippets = DOC_SNIPPETS[type];
  const base = pick(snippets, index);
  const text =
    difficulty === 'adversarial'
      ? `${base} Rechnung Lieferschein gemischt DEMO`
      : base;
  return {
    id: `doc-${String(index).padStart(3, '0')}`,
    use_case: 'document_sort',
    difficulty,
    label: type,
    choices: [
      'Rechnung',
      'Lieferschein',
      'Kostenvoranschlag',
      'Fahrzeugschein',
      'Sonstiges',
    ],
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
