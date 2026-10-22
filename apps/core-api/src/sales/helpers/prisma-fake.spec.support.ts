// Test double for a Prisma subset: each delegate may carry only the methods a test calls.
export function fakePrisma<T>(fake: { [K in keyof T]: Partial<T[K]> }): T {
  return fake as T;
}
