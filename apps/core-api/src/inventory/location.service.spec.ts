import { LocationService } from './location.service';

describe('LocationService', () => {
  it('lists only locations owned by the active site', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new LocationService(
      {
        storageLocation: { findMany },
      } as never,
      {
        getTenantId: jest.fn().mockResolvedValue('tenant-1'),
      } as never,
      {
        getSiteId: jest.fn().mockResolvedValue('site-wien'),
      } as never,
    );

    await service.findAll();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenant_id: 'tenant-1',
          site_id: 'site-wien',
          is_system: false,
          deletedAt: null,
        },
      }),
    );
  });
});
