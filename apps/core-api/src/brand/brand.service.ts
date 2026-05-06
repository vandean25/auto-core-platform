import {
  Inject,
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Brand } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  PrismaRepository,
  PaginatedResult,
} from '../common/repositories/prisma-repository';
import {
  ConflictError,
  NotFoundError,
} from '../common/errors/application-errors';

@Injectable()
export class BrandService {
  private brandRepository?: PrismaRepository<Brand>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  private getBrandRepository(): PrismaRepository<Brand> {
    if (!this.brandRepository) {
      this.brandRepository = new PrismaRepository<Brand>(this.prisma.brand);
    }

    return this.brandRepository;
  }

  async findAll(filters?: {
    isVehicleMake?: boolean;
    isPartManufacturer?: boolean;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Brand>> {
    const tenantId = await this.tenantContext.getTenantId();
    const where = {
      tenant_id: tenantId,
      ...(filters?.isVehicleMake !== undefined && {
        isVehicleMake: filters.isVehicleMake,
      }),
      ...(filters?.isPartManufacturer !== undefined && {
        isPartManufacturer: filters.isPartManufacturer,
      }),
    };

    // When page/limit are explicitly provided, return standard paginated result
    if (filters?.page !== undefined || filters?.limit !== undefined) {
      return this.getBrandRepository().findManyPaginated({
        where,
        orderBy: { name: 'asc' },
        page: filters.page,
        limit: filters.limit,
      });
    }

    // Non-paginated: fetch all via repository, wrap in standard shape
    const brands = await this.getBrandRepository().findMany({
      where,
      orderBy: { name: 'asc' },
    });

    return {
      data: brands,
      meta: {
        total: brands.length,
        page: 1,
        limit: brands.length,
        totalPages: 1,
      },
    };
  }

  async findOne(brandId: number): Promise<Brand> {
    const tenantId = await this.tenantContext.getTenantId();
    const brand = await this.prisma.brand.findFirst({
      where: { id: brandId, tenant_id: tenantId },
    });

    if (!brand) {
      throw new NotFoundException(`Brand with ID ${brandId} not found`);
    }

    return brand;
  }

  async create(createBrandDto: CreateBrandDto): Promise<Brand> {
    const tenantId = await this.tenantContext.getTenantId();
    this.validateBrandTypes(
      createBrandDto.isVehicleMake,
      createBrandDto.isPartManufacturer,
    );

    try {
      return await this.getBrandRepository().create({
        ...createBrandDto,
        tenant_id: tenantId,
      });
    } catch (error) {
      if (error instanceof ConflictError) {
        throw new ConflictException(
          `Brand with name "${createBrandDto.name}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    brandId: number,
    updateBrandDto: UpdateBrandDto,
  ): Promise<Brand> {
    await this.findOne(brandId);
    await this.validateUpdateFlags(brandId, updateBrandDto);

    try {
      return await this.getBrandRepository().update(
        brandId,
        updateBrandDto as unknown as Record<string, unknown>,
      );
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
    await this.findOne(brandId);
    await this.ensureNoDependencies(brandId);

    try {
      return await this.getBrandRepository().delete(brandId);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new NotFoundException(`Brand with ID ${brandId} not found`);
      }
      throw error;
    }
  }

  private validateBrandTypes(
    isVehicleMake?: boolean,
    isPartManufacturer?: boolean,
  ): void {
    if (!isVehicleMake && !isPartManufacturer) {
      throw new BadRequestException('Brand must be at least one type');
    }
  }

  private async validateUpdateFlags(
    brandId: number,
    updateBrandDto: UpdateBrandDto,
  ): Promise<void> {
    const isUpdatingFlags =
      updateBrandDto.isVehicleMake !== undefined ||
      updateBrandDto.isPartManufacturer !== undefined;

    if (!isUpdatingFlags) return;

    const currentBrand = await this.findOne(brandId);
    const nextIsVehicleMake =
      updateBrandDto.isVehicleMake ?? currentBrand.isVehicleMake;
    const nextIsPartManufacturer =
      updateBrandDto.isPartManufacturer ?? currentBrand.isPartManufacturer;

    this.validateBrandTypes(nextIsVehicleMake, nextIsPartManufacturer);
  }

  /**
   * Cross-entity dependency check. Uses raw PrismaService intentionally —
   * the repository pattern covers single-entity CRUD against one delegate;
   * cross-entity queries remain in the service layer.
   */
  private async ensureNoDependencies(brandId: number): Promise<void> {
    const tenantId = await this.tenantContext.getTenantId();
    const catalogItemsCount = await this.prisma.catalogItem.count({
      where: { brand_id: brandId, tenant_id: tenantId },
    });

    if (catalogItemsCount > 0) {
      throw new ConflictException(
        `Cannot delete brand with ${catalogItemsCount} catalog items linked`,
      );
    }

    const vendorsCount = await this.prisma.vendor.count({
      where: {
        tenant_id: tenantId,
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
