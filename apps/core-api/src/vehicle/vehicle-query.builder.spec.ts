import { VehicleQueryBuilder } from './vehicle-query.builder';

describe('VehicleQueryBuilder', () => {
  const tenantId = 'tenant-123';

  describe('buildWhere', () => {
    it('returns tenant_id only when search is not provided', () => {
      expect(VehicleQueryBuilder.buildWhere(tenantId)).toEqual({
        tenant_id: tenantId,
      });
      expect(VehicleQueryBuilder.buildWhere(tenantId, undefined)).toEqual({
        tenant_id: tenantId,
      });
      expect(VehicleQueryBuilder.buildWhere(tenantId, '')).toEqual({
        tenant_id: tenantId,
      });
    });

    it('builds an OR query matching vehicle attributes and customer relations when search is provided', () => {
      const search = 'civic';
      const where = VehicleQueryBuilder.buildWhere(tenantId, search);

      expect(where).toEqual({
        tenant_id: tenantId,
        OR: [
          { make: { contains: search, mode: 'insensitive' } },
          { model: { contains: search, mode: 'insensitive' } },
          { plate: { contains: search, mode: 'insensitive' } },
          { vin: { contains: search, mode: 'insensitive' } },
          { engine_code: { contains: search, mode: 'insensitive' } },
          {
            customer: {
              OR: [
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { company_name: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        ],
      });
    });
  });

  describe('computeOrderBy', () => {
    it('defaults to createdAt desc when no sortField or direction is provided', () => {
      expect(VehicleQueryBuilder.computeOrderBy()).toEqual({
        createdAt: 'desc',
      });
    });

    it('uses the provided direction with default sortField', () => {
      expect(VehicleQueryBuilder.computeOrderBy(undefined, 'asc')).toEqual({
        createdAt: 'asc',
      });
    });

    it('sorts by make', () => {
      expect(VehicleQueryBuilder.computeOrderBy('make', 'asc')).toEqual({
        make: 'asc',
      });
      expect(VehicleQueryBuilder.computeOrderBy('make', 'desc')).toEqual({
        make: 'desc',
      });
    });

    it('sorts by model', () => {
      expect(VehicleQueryBuilder.computeOrderBy('model', 'asc')).toEqual({
        model: 'asc',
      });
    });

    it('sorts by year', () => {
      expect(VehicleQueryBuilder.computeOrderBy('year', 'desc')).toEqual({
        year: 'desc',
      });
    });

    it('sorts by plate', () => {
      expect(VehicleQueryBuilder.computeOrderBy('plate', 'asc')).toEqual({
        plate: 'asc',
      });
    });

    it('sorts by vin', () => {
      expect(VehicleQueryBuilder.computeOrderBy('vin', 'desc')).toEqual({
        vin: 'desc',
      });
    });

    it('sorts by customer last name', () => {
      expect(VehicleQueryBuilder.computeOrderBy('customer', 'asc')).toEqual({
        customer: { last_name: 'asc' },
      });
    });

    it('falls back to createdAt for unknown sortField', () => {
      expect(
        VehicleQueryBuilder.computeOrderBy('unknown_field', 'asc'),
      ).toEqual({
        createdAt: 'asc',
      });
    });
  });

  describe('resolvePagination', () => {
    it('uses default values when page and pageSize are undefined', () => {
      const result = VehicleQueryBuilder.resolvePagination();
      expect(result).toEqual({
        page: 1,
        pageSize: 25,
        skip: 0,
        take: 25,
      });
    });

    it('handles custom valid page and pageSize', () => {
      const result = VehicleQueryBuilder.resolvePagination(3, 15);
      expect(result).toEqual({
        page: 3,
        pageSize: 15,
        skip: 30,
        take: 15,
      });
    });

    it('caps pageSize to 100', () => {
      const result = VehicleQueryBuilder.resolvePagination(1, 250);
      expect(result).toEqual({
        page: 1,
        pageSize: 100,
        skip: 0,
        take: 100,
      });
    });

    it('defaults invalid or non-positive page and pageSize', () => {
      const result = VehicleQueryBuilder.resolvePagination(0, -5);
      expect(result).toEqual({
        page: 1,
        pageSize: 25,
        skip: 0,
        take: 25,
      });
    });
  });
});
