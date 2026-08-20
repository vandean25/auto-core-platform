import { InternalServerErrorException } from '@nestjs/common';

export type PdfGenerationDispatchMode = 'enqueue' | 'inline';

export function resolvePdfGenerationDispatch(params: {
  cloudTasksEnabled: boolean;
  targetBaseUrl: string | undefined;
  nodeEnv: string | undefined;
}): PdfGenerationDispatchMode {
  const hasTargetBaseUrl = Boolean(params.targetBaseUrl?.trim());
  const shouldEnqueue = params.cloudTasksEnabled && hasTargetBaseUrl;

  if (shouldEnqueue) {
    return 'enqueue';
  }

  if (params.nodeEnv === 'production') {
    throw new InternalServerErrorException(
      'Cloud Tasks is not enabled or not correctly configured for PDF generation',
    );
  }

  return 'inline';
}
