import { renderAndUploadPdf } from './pdf-render-upload';

describe('renderAndUploadPdf', () => {
  const uploadResult = {
    bucket: 'bucket',
    key: 'docs/test.pdf',
    etag: 'etag-1',
  };

  it('renders and uploads on first success', async () => {
    const render = jest.fn().mockResolvedValue(Buffer.from('pdf'));
    const upload = jest.fn().mockResolvedValue(uploadResult);

    await expect(
      renderAndUploadPdf({ render, upload }),
    ).resolves.toEqual(uploadResult);

    expect(render).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(Buffer.from('pdf'));
  });

  it('retries transient failures and eventually succeeds', async () => {
    const render = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(Buffer.from('pdf'));
    const upload = jest.fn().mockResolvedValue(uploadResult);
    const onRetry = jest.fn();

    await expect(
      renderAndUploadPdf({ render, upload, onRetry }),
    ).resolves.toEqual(uploadResult);

    expect(render).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not retry 4xx client errors', async () => {
    const clientError = Object.assign(new Error('bad request'), {
      status: 400,
    });
    const render = jest.fn().mockRejectedValue(clientError);
    const upload = jest.fn();

    await expect(renderAndUploadPdf({ render, upload })).rejects.toThrow(
      'bad request',
    );

    expect(render).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });
});
