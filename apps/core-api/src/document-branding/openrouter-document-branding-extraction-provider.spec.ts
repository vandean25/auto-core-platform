import {
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { buildDocumentBrandingExtractionPrompt } from './document-branding-extraction-prompt.js';
import { parseDocumentBrandingExtractionResponse } from './document-branding-extraction-response.js';
import {
  createDocumentBrandingExtractionProvider,
  readDocumentBrandExtractionProviderId,
} from './document-branding-extraction-provider.factory.js';
import { DisabledDocumentBrandingExtractionProvider } from './document-branding-extraction-provider.js';
import {
  OPENROUTER_DEFAULT_MODEL,
  OpenRouterDocumentBrandingExtractionProvider,
} from './openrouter-document-branding-extraction-provider.js';
import { VertexDocumentBrandingExtractionProvider } from './vertex-document-branding-extraction-provider.js';

describe('createDocumentBrandingExtractionProvider', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each([
    ['disabled', DisabledDocumentBrandingExtractionProvider],
    ['', DisabledDocumentBrandingExtractionProvider],
    ['unknown', DisabledDocumentBrandingExtractionProvider],
    ['openrouter', OpenRouterDocumentBrandingExtractionProvider],
    ['vertex', VertexDocumentBrandingExtractionProvider],
  ])(
    'selects %s provider implementation',
    (providerValue, expectedClass) => {
      process.env.DOCUMENT_BRAND_EXTRACTION_PROVIDER = providerValue;

      const provider = createDocumentBrandingExtractionProvider(process.env);

      expect(provider).toBeInstanceOf(expectedClass);
    },
  );

  it('defaults openrouter model when DOCUMENT_BRAND_EXTRACTION_MODEL is unset', () => {
    process.env.DOCUMENT_BRAND_EXTRACTION_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'test-key';
    delete process.env.DOCUMENT_BRAND_EXTRACTION_MODEL;

    const provider = createDocumentBrandingExtractionProvider(process.env);

    expect(provider.getMetadata().modelId).toBe(OPENROUTER_DEFAULT_MODEL);
  });

  it('reads provider id case-insensitively', () => {
    expect(
      readDocumentBrandExtractionProviderId({
        DOCUMENT_BRAND_EXTRACTION_PROVIDER: ' OpenRouter ',
      }),
    ).toBe('openrouter');
  });
});

describe('OpenRouterDocumentBrandingExtractionProvider', () => {
  const validStructuredResponse = {
    confidence: 'SUFFICIENT',
    theme: {
      schemaVersion: 1,
      presetId: 'standard-v1',
      primaryColor: '#123456',
      secondaryColor: '#E5E7EB',
      fontId: 'acp-sans-v1',
      headerBand: 'none',
      footerBand: 'none',
      headerText: 'Auto Core',
      footerText: '',
    },
    warningCodes: [],
    cropRect: null,
  };

  it('returns structured JSON on success without logging secrets or image data', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(validStructuredResponse),
              },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: 'google/gemma-4-31b-it:free',
      fetchImpl,
    });

    const result = await provider.extract({
      normalizedFirstPagePng: Buffer.from('png-bytes'),
      promptVersion: 'document-branding-v1',
      signal: new AbortController().signal,
    });

    expect(result).toEqual(validStructuredResponse);
    expect(parseDocumentBrandingExtractionResponse(result)).toEqual({
      theme: {
        schemaVersion: 1,
        presetId: 'standard-v1',
        logoAssetId: null,
        primaryColor: '#123456',
        secondaryColor: '#E5E7EB',
        fontId: 'acp-sans-v1',
        headerBand: 'none',
        footerBand: 'none',
        headerText: 'Auto Core',
        footerText: '',
      },
      warningCodes: [],
      cropRect: null,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, requestInit] = fetchImpl.mock.calls[0] as [
      string,
      RequestInit | undefined,
    ];
    const requestBody =
      typeof requestInit?.body === 'string' ? requestInit.body : '';
    expect(requestBody).not.toContain('png-bytes');
    expect(requestBody).toContain('data:image/png;base64,');
    expect((requestInit?.headers as Record<string, string>).Authorization).toBe(
      'Bearer secret-key',
    );
  });

  it('reports unavailable when the API key is missing', () => {
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: undefined,
      modelId: OPENROUTER_DEFAULT_MODEL,
    });

    expect(provider.isAvailable()).toBe(false);
  });

  it('rejects extraction when the API key is missing', async () => {
    const fetchImpl = jest.fn();
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: '   ',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl,
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON content', async () => {
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl: jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"confidence":' } }],
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('documents parser-enforced contrast rules in the prompt', () => {
    const prompt = buildDocumentBrandingExtractionPrompt('document-branding-v1');

    expect(prompt).toContain('4.5:1');
    expect(prompt).toContain('#3B82F6');
    expect(() =>
      parseDocumentBrandingExtractionResponse({
        ...validStructuredResponse,
        theme: {
          ...validStructuredResponse.theme,
          primaryColor: '#3B82F6',
        },
      }),
    ).toThrow(UnprocessableEntityException);
  });

  it('rejects undefined structured content without throwing TypeError', async () => {
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl: jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: undefined } }],
          }),
          { status: 200 },
        ),
      ),
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('maps provider rate limits to 429', async () => {
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl: jest
        .fn()
        .mockResolvedValue(new Response('rate limited', { status: 429 })),
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({
      response: { code: 'BRAND_EXTRACTION_PROVIDER_RATE_LIMIT' },
      status: 429,
    });
  });

  it('maps AbortError to a gateway timeout extraction failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl: jest.fn().mockRejectedValue(
        Object.assign(new Error('Aborted'), { name: 'AbortError' }),
      ),
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
      response: { code: 'BRAND_EXTRACTION_ATTEMPT_TIMEOUT' },
    });
  });

  it('maps TimeoutError to a gateway timeout extraction failure', async () => {
    const controller = new AbortController();
    controller.abort();
    const provider = new OpenRouterDocumentBrandingExtractionProvider({
      apiKey: 'secret-key',
      modelId: OPENROUTER_DEFAULT_MODEL,
      fetchImpl: jest.fn().mockRejectedValue(
        Object.assign(new Error('Timeout'), { name: 'TimeoutError' }),
      ),
    });

    await expect(
      provider.extract({
        normalizedFirstPagePng: Buffer.from('png'),
        promptVersion: 'document-branding-v1',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({
      status: HttpStatus.GATEWAY_TIMEOUT,
      response: { code: 'BRAND_EXTRACTION_ATTEMPT_TIMEOUT' },
    });
  });
});
