import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAX_DOMAIN_SERVICE_LINES = 1500;

describe('mechanic domain service size', () => {
  it('keeps every mechanic *.service.ts file under 1500 lines', () => {
    const files = readdirSync(__dirname).filter((name) =>
      name.endsWith('.service.ts'),
    );

    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const lineCount = readFileSync(join(__dirname, file), 'utf8').split(
        '\n',
      ).length;
      expect({
        file,
        overLimit: lineCount >= MAX_DOMAIN_SERVICE_LINES,
      }).toEqual({ file, overLimit: false });
    }
  });
});
