import {
  BadRequestException,
  ConflictException,
  GoneException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const GUARDED_PRICE_KIND = 'RETAIL_PRICE';

export function guardedRequestInvalid(message: string): never {
  throw new BadRequestException({ code: 'GUARDED_REQUEST_INVALID', message });
}

export function operationUnresolved(message: string): never {
  throw new ConflictException({ code: 'OPERATION_UNRESOLVED', message });
}

export function operationFenced(message: string): never {
  throw new ConflictException({ code: 'OPERATION_FENCED', message });
}

export function inventoryRevisionConflict(message: string): never {
  throw new ConflictException({ code: 'INVENTORY_REVISION_CONFLICT', message });
}

export function idempotencyKeyReused(message: string): never {
  throw new UnprocessableEntityException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message,
  });
}

export function idempotencyKeyExpired(message: string): never {
  throw new GoneException({ code: 'IDEMPOTENCY_KEY_EXPIRED', message });
}
