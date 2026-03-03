import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SEARCH_LIMIT = 20;

function buildFitmentFilter(
  make: string,
  model: string,
  year: number,
  engineCode?: string | null,
): Prisma.LaborFitmentWhereInput {
  return {
    make: { equals: make, mode: Prisma.QueryMode.insensitive },
    model: { equals: model, mode: Prisma.QueryMode.insensitive },
    AND: [
      {
        OR: [{ year_from: null }, { year_from: { lte: year } }],
      },
      {
        OR: [{ year_to: null }, { year_to: { gte: year } }],
      },
      ...(engineCode
        ? [
            {
              OR: [
                { engine_code: null },
                {
                  engine_code: {
                    equals: engineCode,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
}

@Injectable()
export class CatalogService {
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

    if (!workshopOrder?.vehicle) {
      throw new NotFoundException(
        `Workshop order ${trimmedWorkshopOrderId} was not found`,
      );
    }

    const { make, model, year, engine_code } = workshopOrder.vehicle;

    const laborFitmentFilter: Prisma.LaborFitmentWhereInput =
      buildFitmentFilter(make, model, year, engine_code);
    const partFitmentFilter: Prisma.PartFitmentWhereInput =
      buildFitmentFilter(
        make,
        model,
        year,
        engine_code,
      ) as Prisma.PartFitmentWhereInput;

    const [laborOperations, masterParts, catalogItems] = await Promise.all([
      this.prisma.laborOperation.findMany({
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
            some: laborFitmentFilter,
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
      }),
      this.prisma.masterPart.findMany({
        where: {
          OR: [
            {
              supplier_part_number: {
                contains: trimmedQuery,
                mode: 'insensitive',
              },
            },
            {
              oem_number: {
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
            {
              brand: {
                contains: trimmedQuery,
                mode: 'insensitive',
              },
            },
          ],
          fitments: {
            some: partFitmentFilter,
          },
        },
        include: {
          local_inventory: true,
        },
        orderBy: [{ supplier_part_number: 'asc' }],
        take: SEARCH_LIMIT,
      }),
      this.prisma.catalogItem.findMany({
        where: {
          OR: [
            {
              sku: {
                contains: trimmedQuery,
                mode: 'insensitive',
              },
            },
            {
              name: {
                contains: trimmedQuery,
                mode: 'insensitive',
              },
            },
          ],
        },
        select: {
          id: true,
          sku: true,
          name: true,
          cost_price: true,
          retail_price: true,
          brand: {
            select: {
              name: true,
            },
          },
          stocks: {
            select: {
              quantity_on_hand: true,
              location: {
                select: {
                  code: true,
                },
              },
            },
          },
        },
        orderBy: [{ sku: 'asc' }],
        take: SEARCH_LIMIT,
      }),
    ]);

    const partResults: Array<{
      id: string;
      supplierPartNumber: string;
      oemNumber: string | null;
      description: string;
      brand: string;
      quantityOnHand: number;
      binLocation: string | null;
      costPrice: number | null;
      retailPrice: number | null;
    }> = [];
    const seenPartNumbers = new Set<string>();

    for (const item of catalogItems) {
      const normalizedSku = item.sku.toLowerCase();
      if (seenPartNumbers.has(normalizedSku)) {
        continue;
      }
      seenPartNumbers.add(normalizedSku);
      const quantityOnHand = item.stocks.reduce(
        (sum, stock) => sum + stock.quantity_on_hand,
        0,
      );
      const preferredLocation = item.stocks.find(
        (stock) => stock.quantity_on_hand > 0,
      );
      partResults.push({
        id: item.id,
        supplierPartNumber: item.sku,
        oemNumber: null,
        description: item.name,
        brand: item.brand?.name ?? 'N/A',
        quantityOnHand,
        binLocation: preferredLocation?.location.code ?? null,
        costPrice: Number(item.cost_price),
        retailPrice: Number(item.retail_price),
      });
      if (partResults.length >= SEARCH_LIMIT) {
        break;
      }
    }

    if (partResults.length < SEARCH_LIMIT) {
      for (const part of masterParts) {
        const normalizedPartNumber = part.supplier_part_number.toLowerCase();
        if (seenPartNumbers.has(normalizedPartNumber)) {
          continue;
        }
        seenPartNumbers.add(normalizedPartNumber);
        partResults.push({
          id: part.id,
          supplierPartNumber: part.supplier_part_number,
          oemNumber: part.oem_number,
          description: part.description,
          brand: part.brand,
          quantityOnHand: part.local_inventory?.quantity_on_hand ?? 0,
          binLocation: part.local_inventory?.bin_location ?? null,
          costPrice: part.local_inventory
            ? Number(part.local_inventory.cost_price)
            : null,
          retailPrice: part.local_inventory
            ? Number(part.local_inventory.retail_price)
            : null,
        });
        if (partResults.length >= SEARCH_LIMIT) {
          break;
        }
      }
    }

    return {
      labor: laborOperations.map((operation) => ({
        id: operation.id,
        code: operation.code,
        description: operation.description,
        standardAw: Number(operation.standard_aw),
        hourlyRate: Number(operation.hourly_rate),
      })),
      parts: partResults.slice(0, SEARCH_LIMIT),
      meta: {
        laborCount: laborOperations.length,
        partCount: partResults.length,
        limit: SEARCH_LIMIT,
      },
    };
  }
}
