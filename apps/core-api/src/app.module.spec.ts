import { AppModule } from './app.module';

describe('AppModule middleware routing', () => {
  it('registers tenant context middleware with an Express 5-compatible wildcard path', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });
    const consumer = { apply };

    new AppModule().configure(consumer);

    expect(forRoutes).toHaveBeenCalledWith('{*path}');
  });
});
