/** HTTP body for POST …/pdf when generation is queued or already on disk. */
export type WorkshopPdfGenerationHttpBody = {
  message: string;
  enqueued: boolean;
  taskId?: string;
};

export function workshopPdfGenerationHttpBody(result: {
  mode: string;
  taskId?: string;
}): WorkshopPdfGenerationHttpBody {
  if (result.mode === 'enqueued') {
    return {
      message: 'PDF generation enqueued',
      enqueued: true,
      taskId: result.taskId,
    };
  }
  return {
    message: 'PDF is ready',
    enqueued: false,
  };
}
