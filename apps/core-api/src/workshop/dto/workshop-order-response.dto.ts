import { IntersectionType } from '@nestjs/swagger';
import { WorkshopOrderResponseMetaDto } from './workshop-order-response-meta.dto.js';
import { WorkshopOrderResponseRelationsDto } from './workshop-order-response-relations.dto.js';

export class WorkshopOrderResponseDto extends IntersectionType(
  WorkshopOrderResponseMetaDto,
  WorkshopOrderResponseRelationsDto,
) {}
