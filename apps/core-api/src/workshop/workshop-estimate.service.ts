import { Injectable } from '@nestjs/common';
import { WorkshopEstimateService as WorkshopEstimateServiceRuntime } from './workshop-estimate.runtime.js';

/** Stable Nest entry path; implementation lives in workshop-estimate.runtime.ts for repowise. */
@Injectable()
export class WorkshopEstimateService extends WorkshopEstimateServiceRuntime {}

export type { EstimateSendOptions } from './workshop-estimate-send.options.js';
