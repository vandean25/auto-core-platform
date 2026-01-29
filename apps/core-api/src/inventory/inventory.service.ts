import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class InventoryService {
    constructor(private prisma: PrismaService) { }

    /**
     * Checks the availability of a part by SKU.
     * If the part is superseded, it recursively checks the stock for the superseding part.
     * @param sku The Manufacturer Part Number (MPN).
     */
    async checkAvailability(sku: string) {
        const item = await this.prisma.catalogItem.findUnique({
            where: { sku },
            include: {
                stock: true,
                superseded_by: {
                    select: { sku: true },
                },
            },
        });

        if (!item) {
            throw new NotFoundException(`Catalog item with SKU ${sku} not found`);
        }

        // If there is a superseding part, recursively check its availability
        if (item.superseded_by) {
            const suggestion = await this.checkAvailability(item.superseded_by.sku);
            return {
                ...suggestion,
                original_sku: sku,
                suggested_sku: item.superseded_by.sku,
                is_superseded: true,
            };
        }

        // Base case: No more supersessions, return current stock
        const onHand = item.stock?.quantity_on_hand || 0;
        const reserved = item.stock?.quantity_reserved || 0;
        const available = onHand - reserved;

        return {
            sku: item.sku,
            name: item.name,
            brand: item.brand,
            quantity_on_hand: onHand,
            quantity_reserved: reserved,
            quantity_available: available,
            is_superseded: false,
        };
    }

    /**
     * Finds items in the inventory with pagination, search, and filtering.
     * @param options Pagination, search, and filter options.
     */
    async findAll(options: {
        page: number;
        limit: number;
        search?: string;
        location?: string;
    }) {
        const { page = 1, limit = 10, search, location } = options;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (search) {
            where.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
                { brand: { contains: search, mode: 'insensitive' } },
            ];
        }

        if (location) {
            where.stock = {
                location: {
                    name: { contains: location, mode: 'insensitive' },
                },
            };
        }

        const [items, total] = await Promise.all([
            this.prisma.catalogItem.findMany({
                where,
                include: {
                    stock: {
                        include: {
                            location: true,
                        },
                    },
                    superseded_by: {
                        select: { id: true },
                    },
                },
                skip,
                take: limit,
            }),
            this.prisma.catalogItem.count({ where }),
        ]);

        const last_page = Math.ceil(total / limit);

        // Transform items to match frontend expected shape
        const transformedItems = items.map((item) => {
            const onHand = item.stock?.quantity_on_hand || 0;
            const reserved = item.stock?.quantity_reserved || 0;
            const available = onHand - reserved;

            let status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'SUPERSEDED';
            if (item.superseded_by) {
                status = 'SUPERSEDED';
            } else if (available > 0) {
                status = 'IN_STOCK';
            } else {
                status = 'OUT_OF_STOCK';
            }

            return {
                id: item.id,
                sku: item.sku,
                name: item.name,
                brand: item.brand || '',
                price: Number(item.retail_price),
                status,
                quantity_available: available,
                warehouse_location: item.stock?.location?.name,
            };
        });

        return {
            data: transformedItems,
            meta: {
                total,
                page,
                last_page,
            },
        };
    }
}
