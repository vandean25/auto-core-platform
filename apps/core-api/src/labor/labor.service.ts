import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLaborOperationDto,
  ListLaborOperationsQueryDto,
  UpdateLaborOperationDto,
} from './dto/labor-operation.dto';

const SEARCH_LIMIT = 20;

@Injectable()
export class LaborService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, workshopOrderId: string) {
    const trimmedQuery = query.trim();
    const trimmedWorkshopOrderId = workshopOrderId.trim();
    if (!trimmedQuery) {
      throw new BadRequestException('q is required');
    }

    if (!trimmedWorkshopOrderId) {
      throw new BadRequestException('workshopOrderId is required');
    }

    const workshopOrder = await this.prisma.workshopOrder.findUnique({
      where: { id: trimmedWorkshopOrderId },
      select: {
        vehicle: {
          select: {
            make: true,
            model: true,
            year: true,
            engine_code: true,
          },
        },
      },
    });

    if (!workshopOrder) {
      throw new NotFoundException(
        `Workshop order ${trimmedWorkshopOrderId} not found`,
      );
    }
    if (!workshopOrder.vehicle) {
      throw new BadRequestException(
        `Workshop order ${trimmedWorkshopOrderId} has no associated vehicle`,
      );
    }

    const { make, model, year, engine_code } = workshopOrder.vehicle;

    const laborWhere: Prisma.LaborOperationWhereInput = {
      is_active: true,
      OR: [
        {
          code: {
            contains: trimmedQuery,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: trimmedQuery,
            mode: 'insensitive',
          },
        },
      ],
      fitments: {
        some: {
          make: { equals: make, mode: 'insensitive' },
          model: { equals: model, mode: 'insensitive' },
          AND: [
            {
              OR: [{ year_from: null }, { year_from: { lte: year } }],
            },
            {
              OR: [{ year_to: null }, { year_to: { gte: year } }],
            },
            engine_code
              ? {
                  OR: [
                    { engine_code: null },
                    {
                      engine_code: { equals: engine_code, mode: 'insensitive' },
                    },
                  ],
                }
              : { engine_code: null },
          ],
        },
      },
    };

    const [laborOperations, total] = await Promise.all([
      this.prisma.laborOperation.findMany({
        where: laborWhere,
        select: {
          id: true,
          code: true,
          description: true,
          standard_aw: true,
          hourly_rate: true,
          category: { select: { name: true } },
        },
        orderBy: [{ code: 'asc' }],
        take: SEARCH_LIMIT,
      }),
      this.prisma.laborOperation.count({
        where: laborWhere,
      }),
    ]);

    return {
      data: laborOperations.map((operation) => ({
        id: operation.id,
        code: operation.code,
        description: operation.description,
        standardAw: Number(operation.standard_aw),
        hourlyRate: Number(operation.hourly_rate),
        categoryName: operation.category?.name ?? null,
      })),
      meta: {
        total,
        limit: SEARCH_LIMIT,
      },
    };
  }

  // ── CRUD ──────────────────────────────────────────────────────────────

  private mapLaborOperation(
    operation: Prisma.LaborOperationGetPayload<{
      include: { category: { select: { id: true; name: true } }; fitments: true };
    }>,
  ) {
    return {
      id: operation.id,
      code: operation.code,
      description: operation.description,
      standardAw: Number(operation.standard_aw),
      hourlyRate: Number(operation.hourly_rate),
      internalCost:
        operation.internal_cost !== null ? Number(operation.internal_cost) : null,
      categoryId: operation.category_id,
      category: operation.category ?? null,
      isActive: operation.is_active,
      fitments: operation.fitments.map((f) => ({
        id: f.id,
        make: f.make,
        model: f.model,
        yearFrom: f.year_from,
        yearTo: f.year_to,
        engineCode: f.engine_code,
      })),
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
    };
  }

  async findAll(query: ListLaborOperationsQueryDto) {
    const {
      search,
      categoryId,
      isActive = true,
      page = 1,
      limit = 25,
      sortField = 'code',
      sortDirection = 'asc',
    } = query;

    const where: Prisma.LaborOperationWhereInput = {};

    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (categoryId !== undefined) {
      where.category_id = categoryId;
    }

    if (isActive !== undefined) {
      where.is_active = isActive;
    }

    const SORT_FIELD_MAP: Record<string, string> = {
      code: 'code',
      description: 'description',
      standardAw: 'standard_aw',
      hourlyRate: 'hourly_rate',
      createdAt: 'createdAt',
    };

    const dbSortField = SORT_FIELD_MAP[sortField] ?? 'code';
    const safeSortDirection = sortDirection === 'desc' ? 'desc' : 'asc';
    const orderBy: Prisma.LaborOperationOrderByWithRelationInput = {
      [dbSortField]: safeSortDirection,
    };

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const skip = (safePage - 1) * safeLimit;

    const [data, total] = await Promise.all([
      this.prisma.laborOperation.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          fitments: true,
        },
        orderBy,
        skip,
        take: safeLimit,
      }),
      this.prisma.laborOperation.count({ where }),
    ]);

    return {
      data: data.map((op) => this.mapLaborOperation(op)),
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit)),
      },
    };
  }

  async findOne(id: string) {
    const operation = await this.prisma.laborOperation.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, name: true } },
        fitments: true,
      },
    });

    if (!operation) {
      throw new NotFoundException(`Labor operation with ID "${id}" not found`);
    }

    return this.mapLaborOperation(operation);
  }

  async create(dto: CreateLaborOperationDto) {
    const existing = await this.prisma.laborOperation.findUnique({
      where: { code: dto.code },
    });
    if (existing) {
      throw new ConflictException(
        `Labor operation with code "${dto.code}" already exists`,
      );
    }

    if (dto.categoryId) {
      const category = await this.prisma.laborCategory.findUnique({
        where: { id: dto.categoryId },
        select: { id: true, is_active: true },
      });
      if (!category) {
        throw new NotFoundException(
          `Labor category with ID "${dto.categoryId}" not found`,
        );
      }
      if (!category.is_active) {
        throw new BadRequestException(
          `Labor category with ID "${dto.categoryId}" is not active`,
        );
      }
    }

    try {
      const created = await this.prisma.laborOperation.create({
        data: {
          code: dto.code,
          description: dto.description,
          standard_aw: dto.standardAw,
          hourly_rate: dto.hourlyRate,
          internal_cost: dto.internalCost ?? null,
          category_id: dto.categoryId ?? null,
          is_active: dto.isActive ?? true,
          fitments: dto.fitments
            ? {
                create: dto.fitments.map((f) => ({
                  make: f.make,
                  model: f.model,
                  year_from: f.yearFrom ?? null,
                  year_to: f.yearTo ?? null,
                  engine_code: f.engineCode ?? null,
                })),
              }
            : undefined,
        },
        include: {
          category: { select: { id: true, name: true } },
          fitments: true,
        },
      });

      return this.mapLaborOperation(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Labor operation with code "${dto.code}" already exists`,
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateLaborOperationDto) {
    const operation = await this.prisma.laborOperation.findUnique({
      where: { id },
    });

    if (!operation) {
      throw new NotFoundException(`Labor operation with ID "${id}" not found`);
    }

    const nullableFields = ['code', 'description', 'standardAw', 'hourlyRate'] as const;
    for (const field of nullableFields) {
      if (dto[field] === null) {
        throw new BadRequestException(`Field "${field}" cannot be null`);
      }
    }

    if (dto.code !== undefined && dto.code !== operation.code) {
      const existing = await this.prisma.laborOperation.findUnique({
        where: { code: dto.code },
      });
      if (existing) {
        throw new ConflictException(
          `Labor operation with code "${dto.code}" already exists`,
        );
      }
    }

    if (dto.categoryId !== undefined && dto.categoryId !== null) {
      const category = await this.prisma.laborCategory.findUnique({
        where: { id: dto.categoryId },
        select: { id: true, is_active: true },
      });
      if (!category) {
        throw new NotFoundException(
          `Labor category with ID "${dto.categoryId}" not found`,
        );
      }
      if (!category.is_active) {
        throw new BadRequestException(
          `Labor category with ID "${dto.categoryId}" is not active`,
        );
      }
    }

    try {
      const updated = await this.prisma.laborOperation.update({
        where: { id },
        data: {
          ...(dto.code !== undefined && { code: dto.code }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.standardAw !== undefined && { standard_aw: dto.standardAw }),
          ...(dto.hourlyRate !== undefined && { hourly_rate: dto.hourlyRate }),
          ...(dto.internalCost !== undefined && {
            internal_cost: dto.internalCost,
          }),
          ...(dto.categoryId !== undefined && { category_id: dto.categoryId }),
          ...(dto.isActive !== undefined && { is_active: dto.isActive }),
          ...(dto.fitments !== undefined && {
            fitments: {
              deleteMany: {},
              create: dto.fitments.map((f) => ({
                make: f.make,
                model: f.model,
                year_from: f.yearFrom ?? null,
                year_to: f.yearTo ?? null,
                engine_code: f.engineCode ?? null,
              })),
            },
          }),
        },
        include: {
          category: { select: { id: true, name: true } },
          fitments: true,
        },
      });

      return this.mapLaborOperation(updated);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `Labor operation with code "${dto.code}" already exists`,
        );
      }
      throw error;
    }
  }

  async softDelete(id: string) {
    const operation = await this.prisma.laborOperation.findUnique({
      where: { id },
    });

    if (!operation) {
      throw new NotFoundException(`Labor operation with ID "${id}" not found`);
    }

    const updated = await this.prisma.laborOperation.update({
      where: { id },
      data: { is_active: false },
    });

    return { id: updated.id, isActive: updated.is_active };
  }
}
