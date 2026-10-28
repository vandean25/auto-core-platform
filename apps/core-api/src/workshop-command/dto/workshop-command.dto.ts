import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  WORKSHOP_COMMAND_CONTRACT_VERSION,
  WORKSHOP_COMMAND_LOCALE,
  WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
} from '../workshop-command.types.js';

export class CommandSelectionDto {
  @ApiProperty({ example: 'customer_id' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  slot!: string;

  @ApiProperty({ example: '51500000-0000-4000-8000-000000000021' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  value!: string;
}

export class InterpretWorkshopCommandDto {
  @ApiProperty({ enum: [WORKSHOP_COMMAND_CONTRACT_VERSION] })
  @IsIn([WORKSHOP_COMMAND_CONTRACT_VERSION])
  contract_version!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  command_id!: string;

  @ApiProperty({ enum: ['keyboard', 'voice_transcript'] })
  @IsIn(['keyboard', 'voice_transcript'])
  source!: 'keyboard' | 'voice_transcript';

  @ApiProperty({ enum: [WORKSHOP_COMMAND_LOCALE] })
  @IsIn([WORKSHOP_COMMAND_LOCALE])
  locale!: string;

  @ApiProperty({
    maxLength: WORKSHOP_COMMAND_MAX_TEXT_LENGTH,
    description:
      'Advisor sentence or edited voice transcript. Never sent to a provider.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(WORKSHOP_COMMAND_MAX_TEXT_LENGTH)
  text!: string;

  @ApiPropertyOptional({ type: [CommandSelectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommandSelectionDto)
  selections?: CommandSelectionDto[];
}

export class ProposeWorkshopCommandDto {
  @ApiProperty({ enum: [WORKSHOP_COMMAND_CONTRACT_VERSION] })
  @IsIn([WORKSHOP_COMMAND_CONTRACT_VERSION])
  contract_version!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  command_id!: string;

  @ApiPropertyOptional({ type: [CommandSelectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CommandSelectionDto)
  selections?: CommandSelectionDto[];
}

export class WorkshopCommandScheduleDto {
  @ApiProperty({ example: '2026-10-16' })
  local_date!: string;

  @ApiProperty({ example: '08:00' })
  local_start!: string;

  @ApiProperty({ example: '10:30' })
  local_end!: string;

  @ApiProperty({ format: 'date-time' })
  start_at!: string;

  @ApiProperty({ format: 'date-time' })
  end_at!: string;

  @ApiProperty({ example: 150 })
  duration_minutes!: number;

  @ApiProperty({ enum: ['preset_sum', 'end_clock'] })
  duration_source!: string;
}

export class WorkshopCommandPositionLineDto {
  @ApiPropertyOptional({ type: String })
  preset_key?: string;

  @ApiProperty({ enum: ['LABOR', 'PART'] })
  kind!: string;

  @ApiProperty({ nullable: true, type: String })
  labor_operation_id!: string | null;

  @ApiProperty({ nullable: true, type: String })
  catalog_item_id!: string | null;

  @ApiProperty()
  description!: string;

  @ApiProperty({ example: '1.500' })
  quantity!: string;

  @ApiProperty({ example: 'h' })
  unit!: string;

  @ApiProperty()
  unit_price_cents!: number;

  @ApiProperty()
  net_cents!: number;

  @ApiProperty({ enum: ['not_applicable', 'unbooked', 'reserved'] })
  reservation!: string;
}

export class WorkshopCommandLoanerDto {
  @ApiProperty()
  requested!: boolean;

  @ApiProperty({ nullable: true, type: String })
  loaner_vehicle_id!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  planned_from!: string | null;

  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  planned_to!: string | null;
}

export class WorkshopCommandPositionPlanDto {
  @ApiProperty({ example: 1 })
  version!: number;

  @ApiProperty({ type: [WorkshopCommandPositionLineDto] })
  lines!: WorkshopCommandPositionLineDto[];
}

@ApiExtraModels(WorkshopCommandPositionLineDto)
export class WorkshopCommandIntentBodyDto {
  @ApiProperty({ enum: [WORKSHOP_COMMAND_CONTRACT_VERSION] })
  contract_version!: string;

  @ApiProperty({ format: 'uuid' })
  command_id!: string;

  @ApiProperty({ format: 'uuid' })
  site_id!: string;

  @ApiProperty()
  timezone!: string;

  @ApiProperty({ format: 'uuid' })
  customer_id!: string;

  @ApiProperty({ format: 'uuid' })
  vehicle_id!: string;

  @ApiProperty({ type: WorkshopCommandScheduleDto })
  schedule!: WorkshopCommandScheduleDto;

  @ApiProperty({ format: 'uuid' })
  bay_id!: string;

  @ApiProperty({ nullable: true, type: String })
  mechanic_id!: string | null;

  @ApiProperty({ type: WorkshopCommandLoanerDto })
  loaner!: WorkshopCommandLoanerDto;

  @ApiProperty({ type: () => WorkshopCommandPositionPlanDto })
  position_plan!: WorkshopCommandPositionPlanDto;

  @ApiProperty({ enum: ['CUSTOMER_REPAIR'] })
  purpose!: string;

  @ApiProperty({ enum: ['SCHEDULED'] })
  order_status!: string;

  @ApiProperty()
  reported_issue!: string;
}

export class WorkshopCommandIntentDto extends WorkshopCommandIntentBodyDto {
  @ApiProperty({ enum: ['ready'] })
  status!: string;
}

export class WorkshopCommandChoiceDto {
  @ApiProperty({ example: 'customer:51500000-0000-4000-8000-000000000021' })
  choice_id!: string;

  @ApiProperty({ example: 'customer_id' })
  slot!: string;

  @ApiProperty()
  value!: string;

  @ApiProperty()
  label!: string;
}

export class WorkshopCommandClarificationDto {
  @ApiProperty({ enum: [WORKSHOP_COMMAND_CONTRACT_VERSION] })
  contract_version!: string;

  @ApiProperty({ enum: ['clarification'] })
  status!: string;

  @ApiProperty({ format: 'uuid' })
  command_id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  prompt!: string;

  @ApiProperty({ type: [WorkshopCommandChoiceDto] })
  choices!: WorkshopCommandChoiceDto[];

  @ApiProperty({ type: 'object', additionalProperties: true })
  recognized!: Record<string, unknown>;

  @ApiProperty({ nullable: true, type: String, example: null })
  proposal!: null;
}

export class WorkshopCommandWouldChangeDto {
  @ApiProperty({ example: 'WorkshopOrder' })
  entity!: string;

  @ApiProperty({ example: 'create' })
  op!: string;

  @ApiProperty({ example: true })
  provisional!: boolean;

  @ApiProperty({ nullable: true, type: String, example: null })
  id!: string | null;

  @ApiPropertyOptional({ example: 'SCHEDULED' })
  status?: string;

  @ApiPropertyOptional({ example: 3 })
  count?: number;

  @ApiPropertyOptional({ format: 'uuid' })
  site_id?: string;
}

export class WorkshopCommandProposalResultDto {
  @ApiProperty({ enum: [WORKSHOP_COMMAND_CONTRACT_VERSION] })
  contract_version!: string;

  @ApiProperty({ enum: ['needs_approval'] })
  status!: string;

  @ApiProperty({ format: 'uuid' })
  command_id!: string;

  @ApiProperty({ format: 'uuid' })
  pending_action_id!: string;

  @ApiProperty({ format: 'uuid' })
  trace_id!: string;

  @ApiProperty({ example: 'workshop.booking_package' })
  action_type!: string;

  @ApiProperty({ enum: ['PROPOSE'] })
  tier!: string;

  @ApiProperty({ example: true })
  provisional!: boolean;

  @ApiProperty({ example: false })
  applied!: boolean;

  @ApiProperty({ type: [WorkshopCommandWouldChangeDto] })
  would_change!: WorkshopCommandWouldChangeDto[];

  @ApiProperty({ type: WorkshopCommandIntentBodyDto })
  intent!: WorkshopCommandIntentBodyDto;
}
