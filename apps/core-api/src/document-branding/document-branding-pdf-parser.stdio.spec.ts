import { EventEmitter } from 'node:events';
import { jest } from '@jest/globals';

const forkMock = jest.fn();
jest.unstable_mockModule('node:child_process', () => ({ fork: forkMock }));

const { DocumentBrandingPdfParser } =
  await import('./document-branding-pdf-parser.js');

describe('DocumentBrandingPdfParser child process stdio', () => {
  it('does not leave worker stderr connected to an undrained pipe', async () => {
    const worker = Object.assign(new EventEmitter(), {
      send: jest.fn(),
      kill: jest.fn(),
    });
    forkMock.mockReturnValue(worker);
    const parser = new DocumentBrandingPdfParser();

    const result = parser.validateAndRasterize(Buffer.from('%PDF-1.7 fixture'));
    worker.emit('error', new Error('end fixture process'));

    await expect(result).rejects.toMatchObject({
      response: { code: 'BRAND_PDF_INVALID' },
    });
    expect(forkMock).toHaveBeenCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({ stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
    );
  });
});
