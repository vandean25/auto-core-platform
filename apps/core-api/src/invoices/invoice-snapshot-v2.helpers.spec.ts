import {
  collectCustomerMissingFields,
  isMissingBrandingConfig,
  matchesBrandingVersion,
  isValidBrandLogoAsset,
  resolveBrandingSnapshot,
  buildCustomerSnapshot,
  buildSellerSnapshot,
  buildInvoiceLineItemSnapshots,
  buildTotalsSnapshot,
  assertAtHighValueBusinessRecipientUid,
  AT_RECIPIENT_UID_REQUIRED_CODE,
} from './invoice-snapshot-v2.helpers.js';
import { CustomerType, DiscountType, InvoiceTaxMode, Prisma } from '@prisma/client';
import { INVOICE_BRANDED_TEMPLATE_VERSION } from './invoice-snapshot-v2.js';
import { FIXED_SOURCE_CATEGORY_KEYS } from '../finance/accounting-profile/accounting-profile.types.js';

describe('invoice-snapshot-v2.helpers', () => {
  describe('collectCustomerMissingFields', () => {
    it('returns empty array when all required fields are present for INDIVIDUAL customer', () => {
      const customer = {
        type: CustomerType.INDIVIDUAL,
        first_name: 'Max',
        last_name: 'Mustermann',
        address_street: 'Musterstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      };

      expect(collectCustomerMissingFields(customer)).toEqual([]);
    });

    it('returns empty array when all required fields are present for COMPANY customer', () => {
      const customer = {
        type: CustomerType.COMPANY,
        company_name: 'ACME Corp',
        first_name: 'Max',
        last_name: 'Mustermann',
        address_street: 'Musterstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      };

      expect(collectCustomerMissingFields(customer)).toEqual([]);
    });

    it('returns missing fields when partial fields are missing', () => {
      const customer = {
        type: CustomerType.INDIVIDUAL,
        first_name: 'Max',
        last_name: 'Mustermann',
        address_street: '',
        address_zip: '   ',
        address_city: 'Wien',
        address_country: 'AT',
      };

      expect(collectCustomerMissingFields(customer)).toEqual([
        'address_street',
        'address_zip',
      ]);
    });

    it('returns missing company_name when COMPANY customer lacks company_name', () => {
      const customer = {
        type: CustomerType.COMPANY,
        company_name: '',
        first_name: 'Max',
        last_name: 'Mustermann',
        address_street: 'Musterstraße 1',
        address_zip: '1010',
        address_city: 'Wien',
        address_country: 'AT',
      };

      expect(collectCustomerMissingFields(customer)).toEqual([
        'company_name',
      ]);
    });

    it('returns all required individual fields for a completely empty customer object', () => {
      expect(collectCustomerMissingFields({})).toEqual([
        'first_name',
        'last_name',
        'address_street',
        'address_zip',
        'address_city',
        'address_country',
      ]);
    });

    it('returns customer when customer is null or undefined', () => {
      expect(collectCustomerMissingFields(null)).toEqual(['customer']);
      expect(collectCustomerMissingFields(undefined)).toEqual(['customer']);
    });
  });

  describe('assertAtHighValueBusinessRecipientUid', () => {
    const atSeller = { country_iso: 'AT' as const };
    const atCompanyCustomer = {
      type: CustomerType.COMPANY,
      address_country: 'AT',
      vat_id: null,
      company_name: 'ACME GmbH',
      first_name: 'Max',
      last_name: 'Mustermann',
      address_street: 'Str 1',
      address_zip: '1010',
      address_city: 'Wien',
    };

    it('requires customer UID above EUR 10,000 for AT seller B2B', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: atSeller,
          customer: atCompanyCustomer as never,
          totalGross: '10000.01',
        }),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: AT_RECIPIENT_UID_REQUIRED_CODE,
            missingFields: ['vat_id'],
          }),
        }),
      );
    });

    it('allows gross total at EUR 10,000.00', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: atSeller,
          customer: atCompanyCustomer as never,
          totalGross: '10000.00',
        }),
      ).not.toThrow();
    });

    it('allows AT B2B with UID present above threshold', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: atSeller,
          customer: { ...atCompanyCustomer, vat_id: 'ATU12345678' } as never,
          totalGross: '50000.00',
        }),
      ).not.toThrow();
    });

    it('does not apply to B2C recipients', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: atSeller,
          customer: {
            ...atCompanyCustomer,
            type: CustomerType.PRIVATE,
          } as never,
          totalGross: '50000.00',
        }),
      ).not.toThrow();
    });

    it('does not apply when seller is not AT', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: { country_iso: 'DE' },
          customer: atCompanyCustomer as never,
          totalGross: '50000.00',
        }),
      ).not.toThrow();
    });

    it('requires UID for non-AT business recipients when AT seller exceeds threshold', () => {
      expect(() =>
        assertAtHighValueBusinessRecipientUid({
          seller: atSeller,
          customer: {
            ...atCompanyCustomer,
            address_country: 'DE',
            vat_id: null,
          } as never,
          totalGross: '10000.01',
        }),
      ).toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: AT_RECIPIENT_UID_REQUIRED_CODE,
            missingFields: ['vat_id'],
          }),
        }),
      );
    });
  });

  describe('branding predicates', () => {
    it('isMissingBrandingConfig detects missing config or missing legal entity', () => {
      expect(isMissingBrandingConfig(null)).toBe(true);
      expect(isMissingBrandingConfig({ id: '' })).toBe(true);
      expect(isMissingBrandingConfig({ id: 'le-1' }, null)).toBe(false);
      expect(
        isMissingBrandingConfig({ id: 'le-1' }, { profile_id: 'prof-1' }),
      ).toBe(false);
    });

    it('matchesBrandingVersion compares template versions', () => {
      expect(
        matchesBrandingVersion(
          INVOICE_BRANDED_TEMPLATE_VERSION,
          INVOICE_BRANDED_TEMPLATE_VERSION,
        ),
      ).toBe(true);
      expect(
        matchesBrandingVersion('legacy-v1', INVOICE_BRANDED_TEMPLATE_VERSION),
      ).toBe(false);
      expect(matchesBrandingVersion(null, INVOICE_BRANDED_TEMPLATE_VERSION)).toBe(
        false,
      );
    });

    it('isValidBrandLogoAsset validates asset candidate fields', () => {
      const validAsset = {
        id: 'asset-1',
        bucket: 'bucket-a',
        object_key: 'logo.png',
        object_generation: '12345',
        sha256: 'abcdef',
        detected_mime_type: 'image/png',
        pixel_width: 200,
        pixel_height: 100,
      };

      expect(isValidBrandLogoAsset(validAsset)).toBe(true);
      expect(isValidBrandLogoAsset(null)).toBe(false);
      expect(isValidBrandLogoAsset({ ...validAsset, bucket: null })).toBe(false);
      expect(isValidBrandLogoAsset({ ...validAsset, object_key: '' })).toBe(false);
      expect(
        isValidBrandLogoAsset({ ...validAsset, object_generation: null }),
      ).toBe(false);
      expect(isValidBrandLogoAsset({ ...validAsset, sha256: '' })).toBe(false);
      expect(
        isValidBrandLogoAsset({ ...validAsset, detected_mime_type: 'image/jpeg' }),
      ).toBe(false);
      expect(isValidBrandLogoAsset({ ...validAsset, pixel_width: 0 })).toBe(false);
      expect(isValidBrandLogoAsset({ ...validAsset, pixel_height: null })).toBe(
        false,
      );
    });
  });

  describe('resolveBrandingSnapshot', () => {
    it('throws SELLER_IDENTITY_INCOMPLETE when legalEntityId is missing', async () => {
      const tx = {} as never;
      await expect(
        resolveBrandingSnapshot(tx, 'tenant-1', '', new Date()),
      ).rejects.toThrow(
        expect.objectContaining({
          response: expect.objectContaining({
            code: 'SELLER_IDENTITY_INCOMPLETE',
          }),
        }),
      );
    });

    it('returns default branding snapshot when no profile exists', async () => {
      const tx = {
        documentBrandProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const now = new Date('2026-09-30T10:00:00Z');

      const branding = await resolveBrandingSnapshot(
        tx as never,
        'tenant-1',
        'le-1',
        now,
      );

      expect(branding).toMatchObject({
        schema_version: 1,
        profile_id: null,
        profile_revision: 0,
        preset_id: 'standard-v1',
        renderer_version: INVOICE_BRANDED_TEMPLATE_VERSION,
        font_id: 'acp-sans-v1',
        logo: null,
        resolved_at: now.toISOString(),
      });
      expect(tx.documentBrandProfile.findFirst).toHaveBeenCalledWith({
        where: { tenant_id: 'tenant-1', legal_entity_id: 'le-1' },
        select: {
          id: true,
          active_revision: true,
          active_theme: true,
          active_logo_asset_id: true,
        },
      });
    });

    it('resolves custom branding with ready logo asset', async () => {
      const logoAssetId = '3b825bc1-dcc9-4f2e-91fc-1b9905e6ba2e';
      const profile = {
        id: '8f507f3d-40e1-47c9-a451-73a2682c8b17',
        active_revision: 3,
        active_logo_asset_id: logoAssetId,
        active_theme: {
          schemaVersion: 1,
          presetId: 'standard-v1',
          logoAssetId,
          primaryColor: '#334155',
          secondaryColor: '#E5E7EB',
          fontId: 'acp-sans-v1',
          headerBand: 'primary',
          footerBand: 'secondary',
          headerText: 'Company Header',
          footerText: 'Company Footer',
        },
      };
      const asset = {
        id: logoAssetId,
        bucket: 'brand-bucket',
        object_key: 'logo.png',
        object_generation: 'gen-1',
        sha256: 'sha-1',
        detected_mime_type: 'image/png',
        pixel_width: 400,
        pixel_height: 150,
      };

      const tx = {
        documentBrandProfile: {
          findFirst: jest.fn().mockResolvedValue(profile),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: logoAssetId }]),
        documentBrandAsset: { findFirst: jest.fn().mockResolvedValue(asset) },
      };
      const now = new Date('2026-09-30T10:00:00Z');

      const branding = await resolveBrandingSnapshot(
        tx as never,
        'tenant-1',
        'le-1',
        now,
      );

      expect(branding.profile_id).toBe('8f507f3d-40e1-47c9-a451-73a2682c8b17');
      expect(branding.profile_revision).toBe(3);
      expect(branding.tokens.primary_color).toBe('#334155');
      expect(branding.logo).toEqual({
        asset_id: logoAssetId,
        bucket: 'brand-bucket',
        key: 'logo.png',
        generation: 'gen-1',
        sha256: 'sha-1',
        mime_type: 'image/png',
        width: 400,
        height: 150,
      });
    });
  });

  describe('sub-builders', () => {
    it('buildCustomerSnapshot builds customer snapshot', () => {
      const customer = {
        type: CustomerType.INDIVIDUAL,
        company_name: null,
        first_name: 'Anna',
        last_name: 'Schmidt',
        email: 'anna@example.com',
        phone: '+43123456',
        vat_id: 'ATU99999999',
        address_street: 'Ring 1',
        address_city: 'Graz',
        address_zip: '8010',
        address_country: 'AT',
      };

      expect(buildCustomerSnapshot(customer)).toEqual(customer);
    });

    it('buildSellerSnapshot builds seller snapshot', () => {
      const seller = {
        name: 'Auto Werkstatt GmbH',
        country_iso: 'AT' as const,
        address_street: 'Werkstraße 5',
        address_line2: 'Tor 2',
        address_zip: '1020',
        address_city: 'Wien',
        tax_number: '123/4567',
        vat_id: 'ATU12345678',
        iban: 'AT123456789012345678',
        bic: 'BKAUATWW',
        bank_name: 'Bank Austria',
        email: 'office@werkstatt.at',
        phone: '+431987654',
        registration_number: 'FN 123456 a',
        registration_court: 'Handelsgericht Wien',
        representatives: 'Johann Schmidt',
      };

      expect(buildSellerSnapshot(seller)).toEqual(seller);
    });

    it('buildInvoiceLineItemSnapshots creates items with standard tax calculation', () => {
      const lines = [
        {
          id: 'line-1',
          description: 'Oil filter',
          quantity: new Prisma.Decimal(2),
          unitPrice: new Prisma.Decimal(15),
          taxRate: new Prisma.Decimal(20),
          lineDiscountType: null,
          lineDiscountValue: null,
          revenueGroupName: 'Parts',
          accountingAllocation: {
            sourceCategoryKey: 'parts',
            sourceCategoryLabel: 'Parts',
            taxMode: 'STANDARD' as const,
            taxRate: '20.00',
            revenueAccount: '8400',
            taxTreatment: 'automatic' as const,
          },
        },
      ];

      const items = buildInvoiceLineItemSnapshots(lines);

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: 'line-1',
        description: 'Oil filter',
        quantity: '2.000',
        unit_price: '15.00',
        tax_rate: '20.00',
        net: '30.00',
        tax: '6.00',
        gross: '36.00',
        revenue_group_name: 'Parts',
      });
    });

    it('buildTotalsSnapshot aggregates net, tax, gross and tax breakdown', () => {
      const items = [
        { net: '100.00', tax: '20.00', gross: '120.00', tax_rate: '20.00' },
        { net: '50.00', tax: '5.00', gross: '55.00', tax_rate: '10.00' },
      ];

      const totals = buildTotalsSnapshot(items);

      expect(totals.total_net).toBe('150.00');
      expect(totals.total_tax).toBe('25.00');
      expect(totals.total_gross).toBe('175.00');
      expect(totals.tax_breakdown).toEqual([
        { rate: '10.00', net: '50.00', tax: '5.00', gross: '55.00' },
        { rate: '20.00', net: '100.00', tax: '20.00', gross: '120.00' },
      ]);
    });

    it('buildTotalsSnapshot handles MARGIN_SCHEME mode', () => {
      const items = [
        { net: '5000.00', tax: '0.00', gross: '5000.00', tax_rate: '0.00' },
      ];

      const totals = buildTotalsSnapshot(items, {
        taxMode: InvoiceTaxMode.MARGIN_SCHEME,
        marginTotalGross: '5000.00',
      });

      expect(totals.total_net).toBe('5000.00');
      expect(totals.total_tax).toBe('0.00');
      expect(totals.total_gross).toBe('5000.00');
      expect(totals.tax_breakdown).toEqual([]);
    });
  });
});
