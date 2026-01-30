import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Vendor } from '@prisma/client';

@Injectable()
export class VendorService {
    constructor(private prisma: PrismaService) { }

    async create(data: { name: string; email: string; accountNumber: string; supportedBrands: string[] }): Promise<Vendor> {
        return this.prisma.vendor.create({
            data: {
                name: data.name,
                email: data.email,
                account_number: data.accountNumber,
                supported_brands: data.supportedBrands,
            },
        });
    }

    async findAll(): Promise<Vendor[]> {
        return this.prisma.vendor.findMany({
            orderBy: { name: 'asc' },
        });
    }

    async findOne(id: string): Promise<Vendor | null> {
        return this.prisma.vendor.findUnique({
            where: { id },
        });
    }

    async update(id: string, data: { name?: string; email?: string; accountNumber?: string; supportedBrands?: string[] }): Promise<Vendor> {
        return this.prisma.vendor.update({
            where: { id },
            data: {
                name: data.name,
                email: data.email,
                account_number: data.accountNumber,
                supported_brands: data.supportedBrands,
            },
        });
    }
}
