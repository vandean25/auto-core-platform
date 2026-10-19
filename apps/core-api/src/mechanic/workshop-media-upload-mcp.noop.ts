import type { WorkshopMediaUploadMcpService } from './workshop-media-upload-mcp.service.js';

export const workshopMediaUploadMcpNoop = {
  previewUploadSlot: () =>
    Promise.reject(
      new Error('WorkshopMediaUploadMcpService is not configured'),
    ),
  createUploadSlot: () =>
    Promise.reject(
      new Error('WorkshopMediaUploadMcpService is not configured'),
    ),
} satisfies Pick<
  WorkshopMediaUploadMcpService,
  'previewUploadSlot' | 'createUploadSlot'
>;
