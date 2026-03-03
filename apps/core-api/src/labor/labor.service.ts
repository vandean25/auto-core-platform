import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
                    { engine_code: { equals: engine_code, mode: 'insensitive' } },
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
      })),
      meta: {
        total,
        limit: SEARCH_LIMIT,
      },
    };
  }
}
