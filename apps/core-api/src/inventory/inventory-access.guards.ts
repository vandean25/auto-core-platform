import { ForbiddenException } from '@nestjs/common';

export const INVENTORY_STOCK_MUTATION_ROLES = ['OWNER', 'ADMIN'] as const;

export function assertCanMutateInventoryStock(role: string | undefined): void {
  if (
    role &&
    (INVENTORY_STOCK_MUTATION_ROLES as readonly string[]).includes(role)
  ) {
    return;
  }
  throw new ForbiddenException(
    'Only OWNER or ADMIN can receive, adjust, or edit inventory items.',
  );
}
