import { applyGcsLifecycle, LIFECYCLE_RULES } from './apply-gcs-lifecycle';

const mockSetMetadata = jest.fn().mockResolvedValue([{}]);
const mockBucket = jest.fn().mockReturnValue({ setMetadata: mockSetMetadata });

jest.mock('@google-cloud/storage', () => ({
  Storage: jest.fn().mockImplementation(() => ({
    bucket: mockBucket,
  })),
}));

describe('applyGcsLifecycle', () => {
  const originalEnv = process.env;
  const mockExit = jest
    .spyOn(process, 'exit')
    .mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit called with code ${code}`);
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  afterAll(() => {
    mockExit.mockRestore();
  });

  it('throws error when INVOICE_PDF_BUCKET is not set', async () => {
    delete process.env.INVOICE_PDF_BUCKET;
    delete process.env.GCP_CREDENTIALS;

    await expect(applyGcsLifecycle()).rejects.toThrow(
      'INVOICE_PDF_BUCKET environment variable is not set.',
    );

    expect(mockSetMetadata).not.toHaveBeenCalled();
  });

  it('applies the correct lifecycle rules to the bucket', async () => {
    process.env.INVOICE_PDF_BUCKET = 'test-invoice-bucket';
    delete process.env.GCP_CREDENTIALS;

    await applyGcsLifecycle();

    expect(mockBucket).toHaveBeenCalledWith('test-invoice-bucket');
    expect(mockSetMetadata).toHaveBeenCalledWith({
      lifecycle: { rule: LIFECYCLE_RULES },
    });
  });

  it('passes the correct lifecycle rules (COLDLINE at 90 days, Delete at 2555 days)', async () => {
    process.env.INVOICE_PDF_BUCKET = 'test-invoice-bucket';
    delete process.env.GCP_CREDENTIALS;

    await applyGcsLifecycle();

    const [calledMetadata] = mockSetMetadata.mock.calls[0] as [
      { lifecycle: { rule: typeof LIFECYCLE_RULES } },
    ];
    const { rule } = calledMetadata.lifecycle;

    expect(rule).toHaveLength(2);

    expect(rule[0]).toMatchObject({
      action: { type: 'SetStorageClass', storageClass: 'COLDLINE' },
      condition: { age: 90 },
    });

    expect(rule[1]).toMatchObject({
      action: { type: 'Delete' },
      condition: { age: 2555 },
    });
  });

  it('initialises Storage with parsed GCP_CREDENTIALS when provided', async () => {
    const { Storage } = jest.requireMock('@google-cloud/storage') as {
      Storage: jest.Mock;
    };

    process.env.INVOICE_PDF_BUCKET = 'test-bucket';
    const creds = { type: 'service_account', project_id: 'test-project' };
    process.env.GCP_CREDENTIALS = JSON.stringify(creds);

    await applyGcsLifecycle();

    expect(Storage).toHaveBeenCalledWith({ credentials: creds });
  });

  it('throws error when GCP_CREDENTIALS is invalid JSON', async () => {
    process.env.INVOICE_PDF_BUCKET = 'test-bucket';
    process.env.GCP_CREDENTIALS = 'not-valid-json';

    await expect(applyGcsLifecycle()).rejects.toThrow(
      'Failed to parse GCP_CREDENTIALS JSON',
    );
  });
});
