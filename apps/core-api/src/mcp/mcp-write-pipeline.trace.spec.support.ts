import { jest } from '@jest/globals';

/** Typed stubs for the three host deps added after invoiceWorkshopDraftPropose. */
export function mcpWriteTracePipelineHostDeps() {
  return {
    workshopEstimateSendPropose: {
      enrichInput: async (input: unknown) => input,
    },
    workshopMediaUploadMcp: {
      previewUploadSlot: jest.fn(),
      createUploadSlot: jest.fn(),
    },
    weeklyReportMcp: {
      preview: jest.fn(),
      execute: jest.fn(),
      refreshReplayResult: jest.fn(),
    },
  };
}
