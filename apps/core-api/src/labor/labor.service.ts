import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const SEARCH_LIMIT = 20;

@Injectable()
export class LaborService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: string, workshopOrderId: string) {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new BadRequestException('q is required');
    }

    if (!workshopOrderId?.trim()) {
      throw new BadRequestException('workshopOrderId is required');
    }

    const workshopOrder = await this.prisma.workshopOrder.findUnique({
      where: { id: workshopOrderId },
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

    if (!workshopOrder?.vehicle) {
      throw new NotFoundException(
        `Workshop order ${workshopOrderId} was not found`,
      );
    }

    const { make, model, year, engine_code } = workshopOrder.vehicle;

    const laborOperations = await this.prisma.laborOperation.findMany({
      where: {
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
      },
      select: {
        id: true,
        code: true,
        description: true,
        standard_aw: true,
        hourly_rate: true,
      },
      orderBy: [{ code: 'asc' }],
      take: SEARCH_LIMIT,
    });

    return {
      data: laborOperations.map((operation) => ({
        id: operation.id,
        code: operation.code,
        description: operation.description,
        standardAw: Number(operation.standard_aw),
        hourlyRate: Number(operation.hourly_rate),
      })),
      meta: {
        total: laborOperations.length,
        limit: SEARCH_LIMIT,
      },
    };
  }
}
