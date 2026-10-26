import {
  isBackgroundImportCandidate,
  readImportSyncMaxRowCount,
} from './import-limits.js';

describe('import limits', () => {
  it('treats files above sync row threshold as background candidates', () => {
    const syncRows = readImportSyncMaxRowCount();
    expect(
      isBackgroundImportCandidate({
        fileBytes: 1000,
        rowCount: syncRows + 1,
      }),
    ).toBe(true);
    expect(
      isBackgroundImportCandidate({
        fileBytes: 1000,
        rowCount: syncRows,
      }),
    ).toBe(false);
  });
});
