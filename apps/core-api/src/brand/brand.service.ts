import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

@Injectable()
export class BrandService {
  constructor(private prisma: PrismaService) {}

  async findAll(filters?: {
    isVehicleMake?: boolean;
    isPartManufacturer?: boolean;
  }) {
    return this.prisma.brand.findMany({
      where: {
        ...(filters?.isVehicleMake !== undefined && {
          isVehicleMake: filters.isVehicleMake,
        }),
        ...(filters?.isPartManufacturer !== undefined && {
          isPartManufacturer: filters.isPartManufacturer,
        }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: number) {
    const brand = await this.prisma.brand.findUnique({
      where: { id },
    });
    if (!brand) {
      throw new NotFoundException(`Brand with ID ${id} not found`);
    }
    return brand;
  }

  async create(createBrandDto: CreateBrandDto) {
    if (!createBrandDto.isVehicleMake && !createBrandDto.isPartManufacturer) {
      throw new BadRequestException('Brand must be at least one type');
    }

    try {
      return await this.prisma.brand.create({
        data: createBrandDto,
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException(
          `Brand with name "${createBrandDto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: number, updateBrandDto: UpdateBrandDto) {
    // If updating flags, ensure at least one is true (if provided)
    if (
      updateBrandDto.isVehicleMake !== undefined ||
      updateBrandDto.isPartManufacturer !== undefined
    ) {
      const currentBrand = await this.findOne(id);
      const nextIsVehicleMake =
        updateBrandDto.isVehicleMake ?? currentBrand.isVehicleMake;
      const nextIsPartManufacturer =
        updateBrandDto.isPartManufacturer ?? currentBrand.isPartManufacturer;

      if (!nextIsVehicleMake && !nextIsPartManufacturer) {
        throw new BadRequestException('Brand must be at least one type');
      }
    }

    try {
      return await this.prisma.brand.update({
        where: { id },
        data: updateBrandDto,
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`Brand with ID ${id} not found`);
      }
      if (error.code === 'P2002') {
        throw new ConflictException(`Brand with name already exists`);
      }
      throw error;
    }
  }

  async remove(id: number) {
    // Check usage in CatalogItems
    const catalogUsage = await this.prisma.catalogItem.count({
      where: { brand_id: id },
    });
    if (catalogUsage > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${catalogUsage} catalog items linked`,
      );
    }

    // Check usage in Vendors
    const vendorUsage = await this.prisma.vendor.count({
      where: {
        supportedBrands: {
          some: { id },
        },
      },
    });
    if (vendorUsage > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${vendorUsage} vendors linked`,
      );
    }

    try {
      return await this.prisma.brand.delete({
        where: { id },
      });
    } catch (error) {
      if (error.code === 'P2025') {
        throw new NotFoundException(`Brand with ID ${id} not found`);
      }
      throw error;
    }
  }
}
