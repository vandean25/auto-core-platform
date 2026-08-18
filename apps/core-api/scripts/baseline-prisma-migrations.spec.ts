import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseBaselinePrismaArgs,
  prismaBaselineResolveArgs,
} from './baseline-prisma-migrations';

describe('parseBaselinePrismaArgs', () => {
  it('fails when --applied is missing', () => {
    expect(() => parseBaselinePrismaArgs([])).toThrow(
      /Missing required --applied=<migration_name> argument/,
    );
  });

  it('parses an inline --applied migration name', () => {
    expect(
      parseBaselinePrismaArgs(['--applied=20260130185623_init_sales_module']),
    ).toEqual({ appliedMigration: '20260130185623_init_sales_module' });
  });

  it('parses a split --applied migration name', () => {
    expect(
      parseBaselinePrismaArgs([
        '--applied',
        '20260130185623_init_sales_module',
      ]),
    ).toEqual({ appliedMigration: '20260130185623_init_sales_module' });
  });
});

describe('prismaBaselineResolveArgs', () => {
  it('builds args for the local prisma binary', () => {
    expect(
      prismaBaselineResolveArgs('20260130185623_init_sales_module'),
    ).toEqual([
      'migrate',
      'resolve',
      '--applied',
      '20260130185623_init_sales_module',
    ]);
  });
});

describe('baseline-prisma-migrations spawn', () => {
  it('does not spawn npx', () => {
    const source = fs.readFileSync(
      path.join(__dirname, 'baseline-prisma-migrations.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/spawnSync\(\s*['"]npx['"]/);
  });
});
