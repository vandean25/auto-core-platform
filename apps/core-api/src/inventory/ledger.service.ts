import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TransactionType, Prisma } from '@prisma/client';
import Decimal = Prisma.Decimal;

export interface RecordTransactionParams {
    itemId: string;
    locationId: string;
    quantity: number | Decimal;
    type: TransactionType;
    referenceId?: string;
    costBasis?: number | Decimal;
}

@Injectable()
export class LedgerService {
    constructor(private prisma: PrismaService) { }

    /**
     * Records an inventory transaction and updates the cached stock quantity.
     * Uses Prisma Interactive Transaction to ensure atomicity.
     * 
     * @param params Transaction parameters
     * @returns The created InventoryTransaction record
     * @throws BadRequestException if the transaction would result in negative stock
     */
    async recordTransaction(params: RecordTransactionParams, prismaVal?: Prisma.TransactionClient) {
        const { itemId, locationId, quantity, type, referenceId, costBasis } = params;
        const prisma = prismaVal || this.prisma;

        const logic = async (tx: Prisma.TransactionClient) => {
            // Step A: Insert the InventoryTransaction record
            const transaction = await tx.inventoryTransaction.create({
                data: {
                    item_id: itemId,
                    location_id: locationId,
                    quantity: new Decimal(quantity.toString()),
                    type,
                    reference_id: referenceId,
                    cost_basis: costBasis ? new Decimal(costBasis.toString()) : null,
                },
            });

            // Step B: Update the cached quantity_on_hand in InventoryStock
            // Use upsert to handle cases where stock record doesn't exist yet
            const stock = await tx.inventoryStock.upsert({
                where: {
                    catalog_item_id_location_id: {
                        catalog_item_id: itemId,
                        location_id: locationId,
                    },
                },
                update: {
                    quantity_on_hand: {
                        increment: Number(quantity),
                    },
                },
                create: {
                    catalog_item_id: itemId,
                    location_id: locationId,
                    quantity_on_hand: Number(quantity),
                    quantity_reserved: 0,
                },
            });

            // Step C: Validate that the resulting stock is not negative
            if (stock.quantity_on_hand < 0) {
                throw new BadRequestException(
                    `Insufficient Stock: Transaction would result in negative stock (${stock.quantity_on_hand}) for item ${itemId} at location ${locationId}`
                );
            }

            return transaction;
        };

        if (prismaVal) {
            // Already in a transaction, just run logic
            return logic(prismaVal);
        } else {
            // Start a new transaction
            return this.prisma.$transaction(logic);
        }
    }

    /**
     * Gets all transactions for a specific item and location.
     * Useful for audit trail and debugging.
     */
    async getTransactionHistory(itemId: string, locationId?: string) {
        return await this.prisma.inventoryTransaction.findMany({
            where: {
                item_id: itemId,
                ...(locationId && { location_id: locationId }),
            },
            select: {
                id: true,
                quantity: true,
                type: true,
                reference_id: true,
                cost_basis: true,
                createdAt: true,
                item: {
                    select: {
                        sku: true,
                        name: true,
                    },
                },
                location: {
                    select: {
                        name: true,
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
    }

    /**
     * Verifies ledger integrity by comparing transaction sum with cached stock.
     * Returns true if they match, false otherwise.
     */
    async verifyLedgerIntegrity(itemId: string, locationId: string): Promise<boolean> {
        const [transactions, stock] = await Promise.all([
            this.prisma.inventoryTransaction.findMany({
                where: {
                    item_id: itemId,
                    location_id: locationId,
                },
            }),
            this.prisma.inventoryStock.findUnique({
                where: {
                    catalog_item_id_location_id: {
                        catalog_item_id: itemId,
                        location_id: locationId,
                    },
                },
            }),
        ]);

        const sumFromTransactions = transactions.reduce(
            (sum, tx) => sum + Number(tx.quantity),
            0
        );

        return sumFromTransactions === (stock?.quantity_on_hand || 0);
    }
}
