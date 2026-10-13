import { NotFoundException } from '@nestjs/common';
import {
  requireDraftSourceAsset,
  requireReadyLogo,
} from './document-branding-asset-guards.js';

describe('document branding asset guards', () => {
  const repositoryReturning = (row: unknown) => {
    const findFirst = jest.fn().mockResolvedValue(row);
    return { findFirst, repository: { findFirst } as never };
  };

  it('skips the lookup when no logo is selected', async () => {
    const { findFirst, repository } = repositoryReturning(null);

    await expect(
      requireReadyLogo(repository, 'tenant-1', 'entity-1', null),
    ).resolves.toBeUndefined();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('requires a selected logo to exist and be ready', async () => {
    await expect(
      requireReadyLogo(
        repositoryReturning({ id: 'logo-1', state: 'QUARANTINED' }).repository,
        'tenant-1',
        'entity-1',
        'logo-1',
      ),
    ).rejects.toMatchObject({ response: { code: 'BRAND_ASSET_NOT_READY' } });
    await expect(
      requireReadyLogo(
        repositoryReturning(null).repository,
        'tenant-1',
        'entity-1',
        'logo-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('attaches only letterhead sources that have not been released', async () => {
    await expect(
      requireDraftSourceAsset(
        repositoryReturning({ id: 'source-1', state: 'READY' }).repository,
        'tenant-1',
        'entity-1',
        'source-1',
      ),
    ).resolves.toBeUndefined();
    await expect(
      requireDraftSourceAsset(
        repositoryReturning({ id: 'source-1', state: 'DELETING' }).repository,
        'tenant-1',
        'entity-1',
        'source-1',
      ),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_ASSET_NOT_ATTACHABLE' },
    });
    await expect(
      requireDraftSourceAsset(
        repositoryReturning(null).repository,
        'tenant-1',
        'entity-1',
        'source-1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
