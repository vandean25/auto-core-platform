import { InternalServerErrorException } from '@nestjs/common';
import type { CloudTasksService } from '../services/cloud-tasks.service';
import type { PdfTaskKind } from './pdf-task-payload';

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

export type EnqueueOrGeneratePdfParams<TResult> = {
  kind: PdfTaskKind;
  resourceId: string;
  resourceName: string;
  tenantId: string;
  targetBaseUrl: string;
  cloudTasks: Pick<CloudTasksService, 'isEnabled' | 'enqueuePdfGeneration'>;
  nodeEnv?: string;
  logger: {
    warn: (msg: string) => void;
    error: (msg: string, stack?: string) => void;
  };
  clearError: () => Promise<void>;
  generateInline: () => Promise<TResult>;
  storeEnqueueError: (errorMessage: string) => Promise<void>;
  onEnqueueError?: (error: unknown) => void;
};

export type EnqueueOrGeneratePdfResult<TResult> =
  { mode: 'enqueued'; taskId: string } | { mode: 'generated'; result: TResult };

export async function enqueueOrGeneratePdf<TResult>(
  params: EnqueueOrGeneratePdfParams<TResult>,
): Promise<EnqueueOrGeneratePdfResult<TResult>> {
  const dispatch = resolvePdfGenerationDispatch({
    cloudTasksEnabled: params.cloudTasks.isEnabled(),
    targetBaseUrl: params.targetBaseUrl,
    nodeEnv: params.nodeEnv,
  });

  if (dispatch === 'inline') {
    const result = await params.generateInline();
    return { mode: 'generated', result };
  }

  try {
    await params.clearError();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger.warn(
      `Failed to clear ${params.resourceName} PDF generation error before enqueue: ${message}`,
    );
  }

  try {
    const { taskId } = await params.cloudTasks.enqueuePdfGeneration({
      kind: params.kind,
      resourceId: params.resourceId,
      tenantId: params.tenantId,
      targetBaseUrl: params.targetBaseUrl,
    });
    return { mode: 'enqueued', taskId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    params.logger.error(
      `Failed to enqueue ${params.resourceName} PDF task: ${message}`,
      error instanceof Error ? error.stack : undefined,
    );

    params.onEnqueueError?.(error);

    if (params.nodeEnv !== 'production') {
      params.logger.warn(
        `Falling back to inline generation for ${params.resourceName} ${params.resourceId}`,
      );
      const result = await params.generateInline();
      return { mode: 'generated', result };
    }

    await params.storeEnqueueError(
      'Failed to enqueue background PDF generation task. Please try again.',
    );

    throw new InternalServerErrorException(
      `Failed to enqueue ${params.resourceName} PDF generation task`,
    );
  }
}
