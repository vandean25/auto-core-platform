import {
  isBackgroundImportCandidate,
  readImportSyncMaxFileBytes,
} from './import-limits.js';

describe('import limits', () => {
  it('treats files above the sync byte threshold as background candidates', () => {
    const syncBytes = readImportSyncMaxFileBytes();
    expect(
      isBackgroundImportCandidate({
        fileBytes: syncBytes + 1,
      }),
    ).toBe(true);
    expect(
      isBackgroundImportCandidate({
        fileBytes: syncBytes,
      }),
    ).toBe(false);
  });
});
