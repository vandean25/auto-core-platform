import { InternalServerErrorException } from '@nestjs/common';
import { resolvePdfGenerationDispatch } from './pdf-generation-dispatch';

describe('resolvePdfGenerationDispatch', () => {
  it('returns enqueue when Cloud Tasks is enabled and target base URL is set', () => {
    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: true,
        targetBaseUrl: 'https://worker.example.com/api',
        nodeEnv: 'production',
      }),
    ).toBe('enqueue');
  });

  it('throws in production when Cloud Tasks is not fully configured', () => {
    expect(() =>
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: 'https://worker.example.com/api',
        nodeEnv: 'production',
      }),
    ).toThrow(InternalServerErrorException);

    expect(() =>
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: true,
        targetBaseUrl: '',
        nodeEnv: 'production',
      }),
    ).toThrow(InternalServerErrorException);
  });

  it('returns inline in non-production when Cloud Tasks is not configured', () => {
    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: '',
        nodeEnv: 'development',
      }),
    ).toBe('inline');

    expect(
      resolvePdfGenerationDispatch({
        cloudTasksEnabled: false,
        targetBaseUrl: '',
        nodeEnv: 'test',
      }),
    ).toBe('inline');
  });
});
