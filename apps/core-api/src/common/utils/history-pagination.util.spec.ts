import {
  buildHistoryMeta,
  resolveHistoryPagination,
} from './history-pagination.util';

describe('history-pagination.util', () => {
  describe('resolveHistoryPagination', () => {
    it('returns defaults when options are omitted', () => {
      expect(resolveHistoryPagination()).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
    });

    it('caps the limit at 100', () => {
      expect(resolveHistoryPagination({ limit: 250 })).toEqual({
        page: 1,
        limit: 100,
        skip: 0,
      });
    });

    it('calculates skip from page and limit', () => {
      expect(resolveHistoryPagination({ page: 3, limit: 10 })).toEqual({
        page: 3,
        limit: 10,
        skip: 20,
      });
    });

    it('falls back to defaults for invalid page and limit', () => {
      expect(resolveHistoryPagination({ page: 0, limit: -5 })).toEqual({
        page: 1,
        limit: 20,
        skip: 0,
      });
    });
  });

  describe('buildHistoryMeta', () => {
    it('builds pagination metadata with hasMore=true when more pages exist', () => {
      expect(
        buildHistoryMeta({ page: 1, limit: 10, skip: 0 }, 25),
      ).toEqual({
        page: 1,
        pageSize: 10,
        totalCount: 25,
        pageCount: 3,
        hasMore: true,
      });
    });

    it('builds pagination metadata with hasMore=false on the last page', () => {
      expect(
        buildHistoryMeta({ page: 3, limit: 10, skip: 20 }, 25),
      ).toEqual({
        page: 3,
        pageSize: 10,
        totalCount: 25,
        pageCount: 3,
        hasMore: false,
      });
    });

    it('treats empty totals as a single page without more results', () => {
      expect(
        buildHistoryMeta({ page: 1, limit: 10, skip: 0 }, 0),
      ).toEqual({
        page: 1,
        pageSize: 10,
        totalCount: 0,
        pageCount: 0,
        hasMore: false,
      });
    });
  });
});
