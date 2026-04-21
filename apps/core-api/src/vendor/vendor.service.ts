import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Vendor, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class VendorService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(data: {
    name: string;
    email: string;
    accountNumber: string;
    brandIds?: number[];
  }): Promise<Vendor> {
    const tenantId = await this.tenantContext.getTenantId();

    if (data.brandIds?.length) {
      const validBrandsCount = await this.prisma.brand.count({
        where: {
          id: { in: data.brandIds },
          tenant_id: tenantId,
        },
      });
      if (validBrandsCount !== data.brandIds.length) {
        throw new BadRequestException('One or more brands are invalid or belong to another tenant');
      }
    }

    const vendor = await this.prisma.vendor.create({
      data: {
        tenant_id: tenantId,
        name: data.name,
        email: data.email,
        account_number: data.accountNumber,
        supportedBrands: data.brandIds
          ? {
              connect: data.brandIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        supportedBrands: true,
      },
    });

    return vendor;
  }

  async findAll(params?: any): Promise<any> {
    const tenantId = await this.tenantContext.getTenantId();
    // return type any to support paginated response
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.vendor.findMany({
          ...params,
          where: { ...(params.where ?? {}), tenant_id: tenantId },
          include: {
            supportedBrands: true,
          },
        }),
        this.prisma.vendor.count({
          where: { ...(params.where ?? {}), tenant_id: tenantId },
        }),
      ]);
      return { data, total };
    }

    return this.prisma.vendor.findMany({
      where: { tenant_id: tenantId },
      include: {
        supportedBrands: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Prisma.VendorGetPayload<{
    include: {
      supportedBrands: true;
      purchase_orders: {
        include: { items: true };
      };
      purchase_invoices: true;
    };
  }> | null> {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.vendor.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        supportedBrands: true,
        purchase_orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            items: true,
          },
        },
        purchase_invoices: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
  }

  async update(
    id: string,
    data: {
      name?: string;
      email?: string;
      accountNumber?: string;
      brandIds?: number[];
    },
  ): Promise<Vendor> {
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.vendor.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }

    if (data.brandIds?.length) {
      const validBrandsCount = await this.prisma.brand.count({
        where: {
          id: { in: data.brandIds },
          tenant_id: tenantId,
        },
      });
      if (validBrandsCount !== data.brandIds.length) {
        throw new BadRequestException('One or more brands are invalid or belong to another tenant');
      }
    }

    const vendor = await this.prisma.vendor.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        account_number: data.accountNumber,
        supportedBrands: data.brandIds
          ? {
              set: data.brandIds.map((id) => ({ id })),
            }
          : undefined,
      },
      include: {
        supportedBrands: true,
      },
    });

    return vendor;
  }

  async remove(id: string): Promise<Vendor> {
    const tenantId = await this.tenantContext.getTenantId();
    const vendor = await this.prisma.vendor.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!vendor) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }

    const [purchaseOrdersCount, purchaseInvoicesCount] = await Promise.all([
      this.prisma.purchaseOrder.count({
        where: { tenant_id: tenantId, vendor_id: id },
      }),
      this.prisma.purchaseInvoice.count({
        where: { tenant_id: tenantId, vendor_id: id },
      }),
    ]);

    if (purchaseOrdersCount > 0 || purchaseInvoicesCount > 0) {
      throw new BadRequestException(
        'Vendor cannot be deleted because purchase orders or purchase invoices are linked.',
      );
    }

    const deleteResult = await this.prisma.vendor.deleteMany({
      where: { id, tenant_id: tenantId },
    });

    if (deleteResult.count === 0) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }

    return vendor;
  }
}
