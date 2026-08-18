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
  it('builds a prisma migrate resolve --applied command', () => {
    expect(
      prismaBaselineResolveArgs('20260130185623_init_sales_module'),
    ).toEqual([
      'prisma',
      'migrate',
      'resolve',
      '--applied',
      '20260130185623_init_sales_module',
    ]);
  });
});
