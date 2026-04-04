import { Injectable } from '@nestjs/common';

@Injectable()
export class CloudTasksService {
  /**
   * Enqueues a task to generate an invoice PDF asynchronously.
   *
   * @param invoiceId The ID of the invoice to generate.
   * @param delaySeconds Optional delay before the task is executed.
   */
  async enqueuePdfGeneration(invoiceId: string, delaySeconds = 0) {
    // This is a placeholder for the Google Cloud Tasks implementation.
    // In a real implementation, this would use @google-cloud/tasks to create a task
    // that targets a specific worker endpoint (e.g., /api/invoices/:id/generate-worker).

    // Simulate task creation delay
    if (delaySeconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(
      `[CloudTasksService] Placeholder: Enqueued PDF generation for invoice ${invoiceId} with ${delaySeconds}s delay`,
    );

    return { taskId: `mock-task-${Date.now()}` };
  }
}
