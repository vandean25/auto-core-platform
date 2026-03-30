import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Brand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import { PrismaRepository, PaginatedResult } from '../common/repositories/prisma-repository';
import {
  ConflictError,
  NotFoundError,
} from '../common/errors/application-errors';

@Injectable()
export class BrandService {
  private readonly brandRepository: PrismaRepository<Brand>;

  constructor(private readonly prisma: PrismaService) {
    this.brandRepository = new PrismaRepository<Brand>(prisma.brand);
  }

  async findAll(filters?: {
    isVehicleMake?: boolean;
    isPartManufacturer?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Brand>> {
    const where = {
      ...(filters?.isVehicleMake !== undefined && {
        isVehicleMake: filters.isVehicleMake,
      }),
      ...(filters?.isPartManufacturer !== undefined && {
        isPartManufacturer: filters.isPartManufacturer,
      }),
    };

    // When page/limit are explicitly provided, return standard paginated result
    if (filters?.page !== undefined || filters?.limit !== undefined) {
      return this.brandRepository.findManyPaginated({
        where,
        orderBy: { name: 'asc' },
        page: filters.page,
        limit: filters.limit,
      });
    }

    // Non-paginated: fetch all via repository, wrap in standard shape
    const brands = await this.brandRepository.findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return {
      data: brands,
      meta: { total: brands.length, page: 1, limit: brands.length, totalPages: 1 },
    };
  }

  async findOne(brandId: number): Promise<Brand> {
    try {
      return await this.brandRepository.findById(brandId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(`Brand with ID ${brandId} not found`);
      }
      throw error;
    }
  }

  async create(createBrandDto: CreateBrandDto): Promise<Brand> {
    this.validateBrandTypes(createBrandDto.isVehicleMake, createBrandDto.isPartManufacturer);

    try {
      return await this.brandRepository.create(createBrandDto as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictException(
          `Brand with name "${createBrandDto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(brandId: number, updateBrandDto: UpdateBrandDto): Promise<Brand> {
    await this.validateUpdateFlags(brandId, updateBrandDto);

    try {
      return await this.brandRepository.update(brandId, updateBrandDto as unknown as Record<string, unknown>);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(`Brand with ID ${brandId} not found`);
      }
      if (error instanceof ConflictError) {
        throw new ConflictException(`Brand with name already exists`);
      }
      throw error;
    }
  }

  async remove(brandId: number): Promise<Brand> {
    await this.ensureNoDependencies(brandId);

    try {
      return await this.brandRepository.delete(brandId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(`Brand with ID ${brandId} not found`);
      }
      throw error;
    }
  }

  private validateBrandTypes(isVehicleMake?: boolean, isPartManufacturer?: boolean): void {
    if (!isVehicleMake && !isPartManufacturer) {
      throw new BadRequestException('Brand must be at least one type');
    }
  }

  private async validateUpdateFlags(brandId: number, updateBrandDto: UpdateBrandDto): Promise<void> {
    const isUpdatingFlags = updateBrandDto.isVehicleMake !== undefined || 
                           updateBrandDto.isPartManufacturer !== undefined;
    
    if (!isUpdatingFlags) return;

    const currentBrand = await this.findOne(brandId);
    const nextIsVehicleMake = updateBrandDto.isVehicleMake ?? currentBrand.isVehicleMake;
    const nextIsPartManufacturer = updateBrandDto.isPartManufacturer ?? currentBrand.isPartManufacturer;

    this.validateBrandTypes(nextIsVehicleMake, nextIsPartManufacturer);
  }

  /**
   * Cross-entity dependency check. Uses raw PrismaService intentionally —
   * the repository pattern covers single-entity CRUD against one delegate;
   * cross-entity queries remain in the service layer.
   */
  private async ensureNoDependencies(brandId: number): Promise<void> {
    const catalogItemsCount = await this.prisma.catalogItem.count({
      where: { brand_id: brandId },
    });
    
    if (catalogItemsCount > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${catalogItemsCount} catalog items linked`,
      );
    }

    const vendorsCount = await this.prisma.vendor.count({
      where: {
        supportedBrands: {
          some: { id: brandId },
        },
      },
    });
    
    if (vendorsCount > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${vendorsCount} vendors linked`,
      );
    }
  }
}
