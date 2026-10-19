import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../common/dto/paginated-response.dto.js';
import { WorkshopOrderHttpResponseDto } from './workshop-order-response.dto.js';

export class WorkshopPaginatedResponseDto {
  @ApiProperty({ type: [WorkshopOrderHttpResponseDto] })
  data!: WorkshopOrderHttpResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
