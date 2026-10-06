import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturePath = join(
  process.cwd(),
  'test/fixtures/agent-eval/labeled-examples.jsonl',
);

const ALLOWED_EMAIL_DOMAINS = ['example.org', 'example.com'];
const REALISTIC_PHONE = /\+49[^0\s]/;
const SK_KEY = /\bsk-[A-Za-z0-9]{10,}\b/;

describe('agent-eval fixture hygiene', () => {
  const lines = readFileSync(fixturePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  it('contains about 200 labelled examples across both use cases', () => {
    expect(lines.length).toBeGreaterThanOrEqual(190);
    expect(lines.length).toBeLessThanOrEqual(210);
    const useCases = new Set(
      lines.map((line) => (JSON.parse(line) as { use_case: string }).use_case),
    );
    expect(useCases.has('import_row_matching')).toBe(true);
    expect(useCases.has('document_sort')).toBe(true);
  });

  it('includes easy, ambiguous, and adversarial difficulty tags', () => {
    const difficulties = new Set(
      lines.map(
        (line) => (JSON.parse(line) as { difficulty: string }).difficulty,
      ),
    );
    expect(difficulties.has('easy')).toBe(true);
    expect(difficulties.has('ambiguous')).toBe(true);
    expect(difficulties.has('adversarial')).toBe(true);
  });

  it('includes false-completion examples whose tempting choice disagrees with the label', () => {
    const examples = lines.map((line) =>
      JSON.parse(line) as {
        choices: string[];
        difficulty: string;
        label: string;
        tags?: string[];
        completion_claim?: { done: boolean; choice: string };
      },
    );
    const falseCompletions = examples.filter((example) =>
      example.tags?.includes('false_completion'),
    );

    expect(falseCompletions.length).toBeGreaterThan(0);
    expect(
      falseCompletions.every(
        (example) =>
          example.difficulty === 'adversarial' &&
          example.completion_claim?.done === true &&
          example.completion_claim.choice !== example.label,
      ),
    ).toBe(true);
  });

  it('avoids real-looking contact data and secret patterns', () => {
    const body = lines.join('\n');
    expect(SK_KEY.test(body)).toBe(false);
    for (const line of lines) {
      const record = JSON.parse(line) as {
        input?: { row?: { email?: string } };
      };
      const email = record.input?.row?.email;
      if (email) {
        const domain = email.split('@')[1];
        expect(ALLOWED_EMAIL_DOMAINS).toContain(domain);
      }
    }
    expect(REALISTIC_PHONE.test(body)).toBe(false);
  });
});
