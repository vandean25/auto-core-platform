import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Vendor } from '@prisma/client';

@Injectable()
export class VendorService {
  constructor(private prisma: PrismaService) {}

  async create(data: {
    name: string;
    email: string;
    accountNumber: string;
    brandIds?: number[];
  }): Promise<Vendor> {
    return this.prisma.vendor.create({
      data: {
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
  }

  async findAll(params?: any): Promise<any> {
    // return type any to support paginated response
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.vendor.findMany({
          ...params,
          include: {
            supportedBrands: true,
          },
        }),
        this.prisma.vendor.count({ where: params.where }),
      ]);
      return { data, total };
    }

    return this.prisma.vendor.findMany({
      include: {
        supportedBrands: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Vendor | null> {
    return this.prisma.vendor.findUnique({
      where: { id },
      include: {
        supportedBrands: true,
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
    return this.prisma.vendor.update({
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
  }

  async remove(id: string): Promise<Vendor> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id },
    });
    if (!vendor) {
      throw new NotFoundException(`Vendor ${id} not found`);
    }

    const [purchaseOrdersCount, purchaseInvoicesCount] = await Promise.all([
      this.prisma.purchaseOrder.count({ where: { vendor_id: id } }),
      this.prisma.purchaseInvoice.count({ where: { vendor_id: id } }),
    ]);

    if (purchaseOrdersCount > 0 || purchaseInvoicesCount > 0) {
      throw new BadRequestException(
        'Vendor cannot be deleted because purchase orders or purchase invoices are linked.',
      );
    }

    return this.prisma.vendor.delete({
      where: { id },
    });
  }
}
