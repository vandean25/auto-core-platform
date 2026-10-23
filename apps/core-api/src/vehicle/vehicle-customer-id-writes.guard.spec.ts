import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `Vehicle.customer_id` follows the active OWNER party, so it may only be written by the party
 * writer (`setOwnerInTx`). This scans the source text for Vehicle create/update/upsert calls
 * whose arguments, minus the `where` filter, mention `customer_id`.
 */
const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PARTY_WRITER = 'vehicle/vehicle-party.writer.ts';
const VEHICLE_WRITE_CALL =
  /\bvehicle\.(?:create|createMany|createManyAndReturn|update|updateMany|upsert)\(/g;

/** Text between the bracket at `open` and its match, brackets included. */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if ('({'.includes(text[i])) depth += 1;
    if (')}'.includes(text[i])) depth -= 1;
    if (depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

// customer_id, or the relation form of it (customer: { connect | disconnect }).
const OWNER_FIELD =
  /\bcustomer_id\b|\bcustomer:\s*\{\s*(?:connect|disconnect)\b/;
const WHERE_BLOCK = /\bwhere:\s*\{/;

function withoutWhere(args: string): string {
  let result = args;
  for (
    let at = result.search(WHERE_BLOCK);
    at !== -1;
    at = result.search(WHERE_BLOCK)
  ) {
    const open = result.indexOf('{', at);
    result =
      result.slice(0, at) + result.slice(open + balanced(result, open).length);
  }
  return result;
}

function findCustomerIdWrites(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(VEHICLE_WRITE_CALL)) {
    const args = balanced(source, match.index + match[0].length - 1);
    if (OWNER_FIELD.test(withoutWhere(args))) hits.push(match[0]);
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
    name !== PARTY_WRITER &&
    // Dev seed data, not request-time code; it creates vehicles without going through a service.
    !name.startsWith('prisma/fixtures/')
  );
};

describe('Vehicle.customer_id writes', () => {
  it('flags a customer_id in the data of a Vehicle write', () => {
    expect(
      findCustomerIdWrites(
        'await tx.vehicle.update({ where: { id }, data: withPlateNormalized({ customer_id: next }) });',
      ),
    ).toHaveLength(1);
    expect(
      findCustomerIdWrites(
        'await tx.vehicle.create({ data: { make, customer_id: null } });',
      ),
    ).toHaveLength(1);
  });

  it('flags the relation form of the owner as well', () => {
    expect(
      findCustomerIdWrites(
        'await tx.vehicle.update({ where: { id }, data: { customer: { disconnect: true } } });',
      ),
    ).toHaveLength(1);
  });

  it('ignores customer_id in a where filter and writes that do not touch it', () => {
    expect(
      findCustomerIdWrites(
        'await tx.vehicle.updateMany({ where: { id, customer_id: expected }, data: { color } });',
      ),
    ).toEqual([]);
    expect(
      findCustomerIdWrites(
        'await tx.vehicle.updateMany({ where: { id }, data: { reserved_for_customer_id: null } });',
      ),
    ).toEqual([]);
  });

  it('is written only by the party writer', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .filter(isScanned)
      .filter(
        (file) => findCustomerIdWrites(readFileSync(file, 'utf8')).length > 0,
      )
      .map((file) => relative(SRC_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
