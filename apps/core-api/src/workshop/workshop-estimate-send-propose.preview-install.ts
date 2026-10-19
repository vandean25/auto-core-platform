import { WorkshopEstimateSendProposeService } from './workshop-estimate-send-propose.service.js';
import {
  bindEstimateSendPreviewHost,
  runEstimateSendPreview,
} from './workshop-estimate-send-propose.preview.js';
import type { EstimateSendProposeResult } from './workshop-estimate-send-propose.service.js';

declare module './workshop-estimate-send-propose.service.js' {
  interface WorkshopEstimateSendProposeService {
    previewSend(
      input: unknown,
      executionContext?: Record<string, unknown>,
    ): Promise<EstimateSendProposeResult>;
  }
}

WorkshopEstimateSendProposeService.prototype.previewSend = function (
  input: unknown,
  executionContext?: Record<string, unknown>,
): Promise<EstimateSendProposeResult> {
  return runEstimateSendPreview(
    bindEstimateSendPreviewHost(this),
    input,
    executionContext,
  );
};
