import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
import { guardedRequestInvalid } from './guarded-price/guarded-price.errors.js';
import { parseExpectedRevision } from './guarded-price/guarded-price.revision.js';
import { retailMajorToMinorUnits } from './guarded-price/guarded-price.money.js';

export type LegacyInventoryPatchBody = {
  mode: 'legacy';
  dto: UpdateInventoryItemDto;
};

export type GuardedInventoryPatchBody = {
  mode: 'guarded';
  retailPrice: number;
  expectedRevision: number;
  targetMinor: bigint;
};

export type InventoryPatchBody =
  LegacyInventoryPatchBody | GuardedInventoryPatchBody;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

@Injectable()
export class InventoryPatchBodyPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): InventoryPatchBody {
    void metadata;
    if (!isRecord(value)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    if (Object.hasOwn(value, 'expectedRevision')) {
      return this.parseGuardedBody(value);
    }

    return this.parseLegacyBody(value);
  }

  private parseGuardedBody(
    raw: Record<string, unknown>,
  ): GuardedInventoryPatchBody {
    const keys = Object.keys(raw);
    if (
      keys.length !== 2 ||
      !keys.includes('retail_price') ||
      !keys.includes('expectedRevision')
    ) {
      guardedRequestInvalid(
        'Guarded PATCH body must contain exactly retail_price and expectedRevision.',
      );
    }
    const expectedRevision = parseExpectedRevision(raw.expectedRevision);
    if (typeof raw.retail_price !== 'number') {
      guardedRequestInvalid('retail_price must be a number.');
    }
    const targetMinor = retailMajorToMinorUnits(raw.retail_price);
    return {
      mode: 'guarded',
      retailPrice: raw.retail_price,
      expectedRevision,
      targetMinor,
    };
  }

  private parseLegacyBody(
    raw: Record<string, unknown>,
  ): LegacyInventoryPatchBody {
    const dto = plainToInstance(UpdateInventoryItemDto, raw);
    const errors = validateSync(dto);
    if (errors.length > 0) {
      throw new BadRequestException(
        errors
          .map((issue) => Object.values(issue.constraints ?? {}).join(', '))
          .join('; '),
      );
    }
    return { mode: 'legacy', dto };
  }
}
