import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class AssignBoardDto {
  @ApiProperty({ description: 'Workshop order ID to assign' })
  @IsUUID()
  orderId!: string;

  @ApiProperty({
    description: 'Mechanic (employee) ID to assign, or null to unassign',
    type: String,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsUUID()
  mechanicId?: string | null;

  @ApiProperty({
    description: 'Bay ID to assign, or null to unassign',
    type: String,
    nullable: true,
    required: false,
  })
  @IsOptional()
  @IsUUID()
  bayId?: string | null;
}
