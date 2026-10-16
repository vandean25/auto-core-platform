import { ApiProperty } from '@nestjs/swagger';
import { AgentProposalStatus } from '@prisma/client';

export class WorkshopMechanicFindingMediaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  mime_type!: string;

  @ApiProperty({ type: String, nullable: true })
  caption!: string | null;

  @ApiProperty({
    description:
      'Short-lived signed URL for the advisor to open the bay photo or video.',
  })
  read_url!: string;
}

export class WorkshopMechanicFindingDto {
  @ApiProperty({ format: 'uuid' })
  proposal_id!: string;

  @ApiProperty({ format: 'uuid' })
  trace_id!: string;

  @ApiProperty({ enum: AgentProposalStatus })
  status!: AgentProposalStatus;

  @ApiProperty({ format: 'uuid' })
  workshop_task_id!: string;

  @ApiProperty()
  finding_text!: string;

  @ApiProperty({ type: [WorkshopMechanicFindingMediaDto] })
  media!: WorkshopMechanicFindingMediaDto[];

  @ApiProperty({ type: String, nullable: true })
  summary!: string | null;

  @ApiProperty({ type: String })
  created_at!: string;
}

export class WorkshopMechanicFindingListResponseDto {
  @ApiProperty({ type: [WorkshopMechanicFindingDto] })
  data!: WorkshopMechanicFindingDto[];
}
