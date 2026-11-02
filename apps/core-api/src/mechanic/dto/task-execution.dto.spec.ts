import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validateSync } from 'class-validator';
import { LaborPauseReason } from '@prisma/client';
import { PauseTaskDto, SwitchTaskDto } from './task-execution.dto.js';

function constraintMessages(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

const PAUSE_REASON_VALUES = [
  LaborPauseReason.WAITING_PARTS,
  LaborPauseReason.WAITING_CUSTOMER,
  LaborPauseReason.OTHER,
].join(', ');

const SWITCH_REASON_VALUES = [
  LaborPauseReason.WAITING_PARTS,
  LaborPauseReason.WAITING_CUSTOMER,
  LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
].join(', ');

describe('task-execution.dto', () => {
  it('lists the allowed pause reasons when pauseReason is rejected', () => {
    const dto = plainToInstance(PauseTaskDto, {
      pauseReason: LaborPauseReason.AUTO_SHIFT_CLOSE,
    });

    expect(constraintMessages(validateSync(dto))).toContain(
      `pauseReason must be one of the following values: ${PAUSE_REASON_VALUES}`,
    );
  });

  it('lists the allowed switch reasons when previousPauseReason is rejected', () => {
    const dto = plainToInstance(SwitchTaskDto, {
      previousPauseReason: LaborPauseReason.OTHER,
    });

    expect(constraintMessages(validateSync(dto))).toContain(
      `previousPauseReason must be one of the following values: ${SWITCH_REASON_VALUES}`,
    );
  });

  it('accepts an allowed value for pauseReason', () => {
    const dto = plainToInstance(PauseTaskDto, {
      pauseReason: LaborPauseReason.WAITING_PARTS,
    });

    expect(validateSync(dto)).toEqual([]);
  });

  it('accepts an allowed value for previousPauseReason', () => {
    const dto = plainToInstance(SwitchTaskDto, {
      previousPauseReason: LaborPauseReason.SWITCHED_TO_HIGHER_PRIORITY,
    });

    expect(validateSync(dto)).toEqual([]);
  });
});
