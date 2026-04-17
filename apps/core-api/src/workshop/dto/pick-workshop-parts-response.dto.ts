import { ApiProperty } from '@nestjs/swagger';

export class PickWorkshopPartAllocationResponseDto {
  @ApiProperty({ format: 'uuid' })
  sourceLocationId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  quantity!: number;

  @ApiProperty()
  referenceId!: string;
}

export class PickWorkshopPartMovedLineResponseDto {
  @ApiProperty({ format: 'uuid' })
  workshopTaskLineItemId!: string;

  @ApiProperty({ example: 4, minimum: 1 })
  movedQuantity!: number;

  @ApiProperty({
    type: () => [PickWorkshopPartAllocationResponseDto],
  })
  allocations!: PickWorkshopPartAllocationResponseDto[];
}

export class PickWorkshopPartsResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  stagingLocationId!: string;

  @ApiProperty({ example: 'WO-PICK-<order-id>-<timestamp>' })
  transferGroupId!: string;

  @ApiProperty({
    type: () => [PickWorkshopPartMovedLineResponseDto],
  })
  movedLines!: PickWorkshopPartMovedLineResponseDto[];
}
