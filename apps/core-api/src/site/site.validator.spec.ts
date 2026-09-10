import {
  BadRequestException,
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  assertSiteDeletable,
  assertSiteUpdatePayloadValid,
  validateLegalEntityCreateInput,
  validateSiteCreateInput,
  validateSiteMembershipCreateInput,
  validateSiteUpdateInput,
} from './site.validator';

describe('site.validator', () => {
  describe('validateLegalEntityCreateInput', () => {
    it('throws BadRequestException for unsupported countryIso', () => {
      expect(() =>
        validateLegalEntityCreateInput(
          { name: 'Entity', countryIso: 'FR' as never },
          null,
        ),
      ).toThrow(BadRequestException);
    });

    it('throws ConflictException if entity with name already exists', () => {
      expect(() =>
        validateLegalEntityCreateInput(
          { name: 'Entity', countryIso: 'AT' },
          { id: 'le-1' },
        ),
      ).toThrow(ConflictException);
    });

    it('passes for valid input', () => {
      expect(() =>
        validateLegalEntityCreateInput(
          { name: 'Entity', countryIso: 'AT' },
          null,
        ),
      ).not.toThrow();
    });
  });

  describe('validateSiteCreateInput', () => {
    it('derives AT defaults correctly', () => {
      const result = validateSiteCreateInput(
        { code: 'S1', name: 'Site 1', legalEntityId: 'le-1' },
        'AT',
      );
      expect(result.timezone).toBe('Europe/Vienna');
      expect(result.holidayCountry).toBe('AT');
      expect(result.slotMinutes).toBe(30);
      expect(result.openingHours).toHaveLength(7);
    });

    it('derives DE defaults correctly', () => {
      const result = validateSiteCreateInput(
        { code: 'S1', name: 'Site 1', legalEntityId: 'le-1' },
        'DE',
      );
      expect(result.timezone).toBe('Europe/Berlin');
      expect(result.holidayCountry).toBe('DE');
    });

    it('throws BadRequestException for invalid weekday count', () => {
      expect(() =>
        validateSiteCreateInput(
          {
            code: 'S1',
            name: 'Site 1',
            legalEntityId: 'le-1',
            openingHours: [
              { weekday: 1, isClosed: false, openTime: '08:00', closeTime: '17:00' },
            ],
          },
          'AT',
        ),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException for closeTime <= openTime', () => {
      const invalidHours = Array.from({ length: 7 }, (_, i) => ({
        weekday: i + 1,
        isClosed: false,
        openTime: '17:00',
        closeTime: '08:00',
      }));
      expect(() =>
        validateSiteCreateInput(
          {
            code: 'S1',
            name: 'Site 1',
            legalEntityId: 'le-1',
            openingHours: invalidHours,
          },
          'AT',
        ),
      ).toThrow(BadRequestException);
    });
  });

  describe('assertSiteUpdatePayloadValid', () => {
    it('throws BadRequestException when legalEntityId is supplied', () => {
      expect(() =>
        assertSiteUpdatePayloadValid({ legalEntityId: 'le-2' } as never),
      ).toThrow(BadRequestException);
    });

    it('passes when legalEntityId is undefined', () => {
      expect(() => assertSiteUpdatePayloadValid({ name: 'New Name' })).not.toThrow();
    });
  });

  describe('validateSiteUpdateInput', () => {
    it('throws UnprocessableEntityException when reactivating under inactive legal entity', () => {
      expect(() =>
        validateSiteUpdateInput(
          { isActive: true },
          { id: 's-1', is_active: false, legal_entity_id: 'le-1' },
          false,
        ),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException when deactivating site (ruling 41)', () => {
      expect(() =>
        validateSiteUpdateInput(
          { isActive: false },
          { id: 's-1', is_active: true, legal_entity_id: 'le-1' },
          true,
        ),
      ).toThrow(ConflictException);
    });

    it('passes for valid name update', () => {
      expect(() =>
        validateSiteUpdateInput(
          { name: 'Updated Site' },
          { id: 's-1', is_active: true, legal_entity_id: 'le-1' },
          true,
        ),
      ).not.toThrow();
    });
  });

  describe('assertSiteDeletable', () => {
    it('throws ConflictException if site has memberships', () => {
      expect(() =>
        assertSiteDeletable(
          {
            _count: { memberships: 1, bays: 0 },
            storageLocations: [{ is_system: true, type: 'in_transit' }],
          },
          0,
        ),
      ).toThrow(ConflictException);
    });

    it('throws ConflictException if site has bays', () => {
      expect(() =>
        assertSiteDeletable(
          {
            _count: { memberships: 0, bays: 1 },
            storageLocations: [{ is_system: true, type: 'in_transit' }],
          },
          0,
        ),
      ).toThrow(ConflictException);
    });

    it('throws ConflictException if non-transit storage location exists', () => {
      expect(() =>
        assertSiteDeletable(
          {
            _count: { memberships: 0, bays: 0 },
            storageLocations: [
              { is_system: true, type: 'in_transit' },
              { is_system: false, type: 'vehicle_lot' },
            ],
          },
          0,
        ),
      ).toThrow(ConflictException);
    });

    it('throws ConflictException if parked dealer vehicles exist', () => {
      expect(() =>
        assertSiteDeletable(
          {
            _count: { memberships: 0, bays: 0 },
            storageLocations: [{ is_system: true, type: 'in_transit' }],
          },
          2,
        ),
      ).toThrow(ConflictException);
    });

    it('returns true when pristine with empty system transit location', () => {
      const result = assertSiteDeletable(
        {
          _count: { memberships: 0, bays: 0 },
          storageLocations: [{ is_system: true, type: 'in_transit' }],
        },
        0,
      );
      expect(result).toBe(true);
    });
  });

  describe('validateSiteMembershipCreateInput', () => {
    it('throws BadRequestException if member does not exist', () => {
      expect(() => validateSiteMembershipCreateInput(null, null)).toThrow(
        BadRequestException,
      );
    });

    it('throws UnprocessableEntityException if member is inactive', () => {
      expect(() =>
        validateSiteMembershipCreateInput({ id: 'm-1', is_active: false }, null),
      ).toThrow(UnprocessableEntityException);
    });

    it('throws ConflictException if membership already exists', () => {
      expect(() =>
        validateSiteMembershipCreateInput(
          { id: 'm-1', is_active: true },
          { id: 'sm-1' },
        ),
      ).toThrow(ConflictException);
    });

    it('passes for valid eligible member', () => {
      expect(() =>
        validateSiteMembershipCreateInput(
          { id: 'm-1', is_active: true },
          null,
        ),
      ).not.toThrow();
    });
  });
});
