import {
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { buildDocumentBrandingExtractionPrompt } from './document-branding-extraction-prompt.js';
import type {
  DocumentBrandingExtractionInput,
  DocumentBrandingExtractionProvider,
} from './document-branding-extraction-provider.js';

export const OPENROUTER_DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
export const OPENROUTER_CHAT_COMPLETIONS_URL =
  'https://openrouter.ai/api/v1/chat/completions';
const MAX_STRUCTURED_RESPONSE_BYTES = 8 * 1024;

export type HttpFetch = typeof fetch;

export type OpenRouterDocumentBrandingExtractionProviderConfig = {
  apiKey: string | undefined;
  modelId: string;
  fetchImpl?: HttpFetch;
};

export class OpenRouterDocumentBrandingExtractionProvider implements DocumentBrandingExtractionProvider {
  private readonly logger = new Logger(
    OpenRouterDocumentBrandingExtractionProvider.name,
  );
  private readonly apiKey: string | undefined;
  private readonly modelId: string;
  private readonly fetchImpl: HttpFetch;

  constructor(config: OpenRouterDocumentBrandingExtractionProviderConfig) {
    this.apiKey = normalizeSecret(config.apiKey);
    this.modelId = config.modelId.trim() || OPENROUTER_DEFAULT_MODEL;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  getMetadata(): { providerId: string; modelId: string } {
    return { providerId: 'openrouter', modelId: this.modelId };
  }

  async extract(input: DocumentBrandingExtractionInput): Promise<unknown> {
    if (!this.isAvailable()) {
      throw new ServiceUnavailableException({
        code: 'BRAND_EXTRACTION_UNAVAILABLE',
        message: 'Letterhead extraction is not currently available.',
      });
    }

    const prompt = buildDocumentBrandingExtractionPrompt(input.promptVersion);
    const imageUrl = `data:image/png;base64,${input.normalizedFirstPagePng.toString('base64')}`;

    try {
      const response = await this.fetchImpl(OPENROUTER_CHAT_COMPLETIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelId,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: input.signal,
      });

      if (response.status === 429) {
        throw new HttpException(
          {
            code: 'BRAND_EXTRACTION_PROVIDER_RATE_LIMIT',
            message: 'The letterhead extraction provider is rate limited.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      if (!response.ok) {
        this.logger.warn(
          `OpenRouter letterhead extraction request failed with status ${response.status}`,
        );
        throw new HttpException(
          {
            code: 'BRAND_EXTRACTION_FAILED',
            message: 'Letterhead extraction failed.',
          },
          HttpStatus.BAD_GATEWAY,
        );
      }

      const payload = (await response.json()) as unknown;
      const content = extractMessageContent(payload);
      return parseStructuredProviderContent(content);
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) {
        throw new HttpException(
          {
            code: 'BRAND_EXTRACTION_ATTEMPT_TIMEOUT',
            message: 'Letterhead extraction timed out.',
          },
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      throw error;
    }
  }
}

function normalizeSecret(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function extractMessageContent(payload: unknown): unknown {
  if (!isPlainRecord(payload)) {
    throw providerOutputInvalid();
  }
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length < 1) {
    throw providerOutputInvalid();
  }
  const firstChoice: unknown = choices[0];
  if (!isPlainRecord(firstChoice)) {
    throw providerOutputInvalid();
  }
  const message = firstChoice.message;
  if (!isPlainRecord(message) || !('content' in message)) {
    throw providerOutputInvalid();
  }
  return message.content;
}

function parseStructuredProviderContent(content: unknown): unknown {
  const parsed =
    typeof content === 'string' ? parseJsonString(content) : content;
  assertStructuredResponseSize(parsed);
  return parsed;
}

function parseJsonString(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw providerOutputInvalid();
  }
}

function assertStructuredResponseSize(value: unknown): void {
  let serialized: string;
  try {
    serialized = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    throw providerOutputInvalid();
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_STRUCTURED_RESPONSE_BYTES) {
    throw providerOutputInvalid();
  }
}

function providerOutputInvalid(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'BRAND_EXTRACTION_OUTPUT_INVALID',
    message: 'Letterhead extraction returned an invalid response.',
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
