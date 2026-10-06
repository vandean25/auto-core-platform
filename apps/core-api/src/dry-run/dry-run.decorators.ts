import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader, ApiQuery } from '@nestjs/swagger';
import {
  DRY_RUN_SUPPORTED_KEY,
  DRY_RUN_REFUSED_KEY,
  DRY_RUN_HEADER,
  DRY_RUN_QUERY_PARAM,
} from './dry-run.constants.js';

export function DryRunSupported() {
  return applyDecorators(
    SetMetadata(DRY_RUN_SUPPORTED_KEY, true),
    ApiQuery({
      name: DRY_RUN_QUERY_PARAM,
      required: false,
      type: Boolean,
      description:
        'Simulate the state changes of this operation within a rolled-back transaction without persisting data.',
    }),
    ApiHeader({
      name: DRY_RUN_HEADER,
      description: 'Present and set to true when dry_run was active.',
      required: false,
    }),
  );
}

export function DryRunRefused(reason?: string) {
  return SetMetadata(DRY_RUN_REFUSED_KEY, {
    refused: true,
    reason: reason ?? 'Dry run is not supported for this operation.',
  });
}
