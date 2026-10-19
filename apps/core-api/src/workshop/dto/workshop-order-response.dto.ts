import { ApiSchema, IntersectionType } from '@nestjs/swagger';
import { WorkshopOrderResponseMetaDto } from './workshop-order-response-meta.dto.js';
import { WorkshopOrderResponseRelationsDto } from './workshop-order-response-relations.dto.js';

@ApiSchema({ name: 'WorkshopOrderResponseDto' })
export class WorkshopOrderHttpResponseDto extends IntersectionType(
  WorkshopOrderResponseMetaDto,
  WorkshopOrderResponseRelationsDto,
) {}
