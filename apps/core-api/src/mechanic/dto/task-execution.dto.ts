import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { LaborPauseReason } from '@prisma/client';

/**
 * Allowed pause reasons for the Pause endpoint.
 * AUTO_SHIFT_CLOSE is reserved for the nightly scheduler and is excluded here.
 */
const PAUSE_REASONS = [
  LaborPauseReason.WAITING_PARTS,
  LaborPauseReason.WAITING_CUSTOMER,
  LaborPauseReason.OTHER,
] as const;

export type MechanicPauseReason = (typeof PAUSE_REASONS)[number];

/**
 * Allowed previous-task pause reasons for the Switch endpoint.
 */
const SWITCH_PAUSE_REASONS = [
  LaborPauseReason.WAITING_PARTS,
  LaborPauseReason.WAITING_CUSTOMER,
  LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
] as const;

export type MechanicSwitchPreviousPauseReason =
  (typeof SWITCH_PAUSE_REASONS)[number];

export class PauseTaskDto {
  @ApiProperty({
    enum: PAUSE_REASONS,
    description:
      'Reason for pausing the task. AUTO_SHIFT_CLOSE is reserved for the scheduler.',
  })
  @IsEnum(PAUSE_REASONS)
  pause_reason!: MechanicPauseReason;
}

export class SwitchTaskDto {
  @ApiProperty({
    enum: SWITCH_PAUSE_REASONS,
    description:
      'Pause reason applied to the task being vacated. Determines the resulting status of the previous task.',
  })
  @IsEnum(SWITCH_PAUSE_REASONS)
  previous_pause_reason!: MechanicSwitchPreviousPauseReason;
}
