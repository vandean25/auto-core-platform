import { ApiProperty } from '@nestjs/swagger';

export class PartsShortageResponseDto {
  @ApiProperty({ format: 'uuid' })
  workshopOrderId!: string;

  @ApiProperty()
  workshopOrderNumber!: string;

  @ApiProperty({ format: 'uuid' })
  workshopTaskId!: string;

  @ApiProperty({ format: 'uuid' })
  workshopTaskLineItemId!: string;

  @ApiProperty()
  itemNo!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '4.000' })
  lineQuantity!: string;

  @ApiProperty({ type: String, example: '1.500' })
  consumedQuantity!: string;

  @ApiProperty({ type: String, example: '1.000' })
  activeCommitment!: string;

  @ApiProperty({ type: String, example: '1.500' })
  shortageQuantity!: string;

  @ApiProperty({ format: 'uuid' })
  siteId!: string;
}
