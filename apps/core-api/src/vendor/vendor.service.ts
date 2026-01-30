import { Injectable } from '@nestjs/common';
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

  async findAll(): Promise<Vendor[]> {
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
}