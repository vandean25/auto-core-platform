import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto.js';
import { createGlobalValidationPipe } from '../common/validation.pipe.js';
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
  private readonly legacyValidationPipe = createGlobalValidationPipe();
  async transform(
    value: unknown,
    metadata: ArgumentMetadata,
  ): Promise<InventoryPatchBody> {
    void metadata;
    if (!isRecord(value)) {
      throw new BadRequestException('Request body must be a JSON object.');
    }

    if (Object.hasOwn(value, 'expectedRevision')) {
      return this.parseGuardedBody(value);
    }

    return await this.parseLegacyBody(value);
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

  private async parseLegacyBody(
    raw: Record<string, unknown>,
  ): Promise<LegacyInventoryPatchBody> {
    const dto = (await this.legacyValidationPipe.transform(raw, {
      type: 'body',
      metatype: UpdateInventoryItemDto,
    })) as UpdateInventoryItemDto;
    return { mode: 'legacy', dto };
  }
}
