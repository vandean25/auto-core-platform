import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PHONE_UTIL = 'customer/customer-phone.util.ts';
const CUSTOMER_WRITE_CALL =
  /\bcustomer\.(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\(/g;

function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if ('({'.includes(text[i])) depth += 1;
    if (')}'.includes(text[i])) depth -= 1;
    if (depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

function findPhoneWritesWithoutHelper(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(CUSTOMER_WRITE_CALL)) {
    const args = balanced(source, match.index + match[0].length - 1);
    if (!/\bphone\s*:/.test(args)) {
      continue;
    }
    if (/\bwithPhoneDigits\s*\(/.test(args)) {
      continue;
    }
    hits.push(match[0]);
  }
  return hits;
}

/** Legacy paths assign `data.phone` then pass `data` to updateMany without a `phone:` literal. */
function findUpdateManyPhoneDrift(source: string): string[] {
  if (!/\bdata\.phone\s*=/.test(source)) {
    return [];
  }
  const hits: string[] = [];
  for (const match of source.matchAll(/\bcustomer\.updateMany\(/g)) {
    const args = balanced(source, match.index + match[0].length - 1);
    if (!/\bwithPhoneDigits\s*\(/.test(args)) {
      hits.push('customer.updateMany(');
    }
  }
  return hits;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

const isScanned = (file: string) => {
  const name = relative(SRC_ROOT, file);
  return (
    name.endsWith('.ts') &&
    !/\.spec(\.support)?\.ts$/.test(name) &&
    name !== PHONE_UTIL
  );
};

describe('Customer.phone write paths', () => {
  it('route phone through withPhoneDigits on create/update data', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter(isScanned)
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        const hits = [
          ...findPhoneWritesWithoutHelper(source),
          ...findUpdateManyPhoneDrift(source),
        ];
        return hits.map((hit) => `${relative(SRC_ROOT, file)}: ${hit}`);
      });
    expect(offenders).toEqual([]);
  });
});
