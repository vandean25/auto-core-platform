import { resolvePrismaModelDelegate } from './prisma-delegate';

describe('resolvePrismaModelDelegate', () => {
  it('resolves a model delegate when the extension context is wrapped in an array', () => {
    const findFirst = jest.fn();
    const context = [{ laborCategory: { findFirst } }] as unknown as Record<
      string,
      unknown
    >;

    const delegate = resolvePrismaModelDelegate(context, 'LaborCategory');

    expect(delegate).toEqual({ findFirst });
  });

  it('resolves function-backed Prisma delegates', () => {
    const findFirst = jest.fn();
    const delegate = Object.assign(jest.fn(), { findFirst });
    const context = {
      workshopTask: delegate,
    } as unknown as Record<string, unknown>;

    const resolved = resolvePrismaModelDelegate(context, 'WorkshopTask');

    expect(resolved).toBe(delegate);
  });
});
