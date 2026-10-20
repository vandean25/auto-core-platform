import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';
import { WorkshopOrderResponseDto } from './workshop-order-response.models.dto.js';

export class WorkshopPaginatedResponseDto {
  @ApiProperty({ type: [WorkshopOrderResponseDto] })
  data!: WorkshopOrderResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
