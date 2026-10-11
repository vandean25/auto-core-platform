import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { IMPORT_ERROR_CODES } from './import.constants.js';
import type { VendorRef } from './import-type-handler.js';

/**
 * Finds the supplier of a price list. An explicit vendor id wins. Otherwise the source system
 * is read as a vendor id, then as a name or account number that must match exactly one vendor.
 */
export class ImportVendorResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(
    tenantId: string,
    sourceSystem: string,
    vendorIdOption?: string,
  ): Promise<VendorRef> {
    const explicitVendorId = vendorIdOption?.trim();
    if (explicitVendorId) {
      return this.findExplicitVendor(tenantId, explicitVendorId);
    }

    const candidate = sourceSystem?.trim();
    if (!candidate) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
        message: 'Valid vendor is required for supplier price list import',
      });
    }
    return this.findByCandidate(tenantId, candidate);
  }

  private async findExplicitVendor(
    tenantId: string,
    vendorId: string,
  ): Promise<VendorRef> {
    const vendor = await this.prisma.vendor.findFirst({
      where: { tenant_id: tenantId, id: vendorId },
      select: { id: true, name: true },
    });
    if (!vendor) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
        message: `Lieferant mit ID '${vendorId}' nicht gefunden`,
      });
    }
    return vendor;
  }

  private async findByCandidate(
    tenantId: string,
    candidate: string,
  ): Promise<VendorRef> {
    const vendorById = await this.prisma.vendor.findFirst({
      where: { tenant_id: tenantId, id: candidate },
      select: { id: true, name: true },
    });
    if (vendorById) {
      return vendorById;
    }

    const matches = await this.prisma.vendor.findMany({
      where: {
        tenant_id: tenantId,
        OR: [{ name: candidate }, { account_number: candidate }],
      },
      select: { id: true, name: true },
    });
    if (matches.length === 0) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.SUPPLIER_VENDOR_REQUIRED,
        message: `Lieferant '${candidate}' nicht gefunden`,
      });
    }
    if (matches.length > 1) {
      throw new BadRequestException({
        code: IMPORT_ERROR_CODES.AMBIGUOUS_VENDOR,
        message: `Mehrere Lieferanten mit dem Namen '${candidate}' gefunden. Bitte Lieferanten-ID angeben.`,
      });
    }
    return matches[0];
  }
}
