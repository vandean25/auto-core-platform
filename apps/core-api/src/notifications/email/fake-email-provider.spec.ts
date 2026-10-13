import { EmailProviderError } from './email-provider.js';
import { FakeEmailProvider } from './fake-email-provider.js';

const message = {
  to: 'kunde@example.at',
  from: { email: 'kontakt@example.at', name: 'Werkstatt' },
  replyTo: null,
  subject: 'Auftrag Nr. 1',
  text: 'Guten Tag,',
  tags: ['test'],
};

describe('FakeEmailProvider', () => {
  it('accepts the message, records it and returns a provider id', async () => {
    const provider = new FakeEmailProvider();

    const result = await provider.send(message, { idempotencyKey: 'row-1' });

    expect(result.providerMessageId).toMatch(/^fake-/);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].options.idempotencyKey).toBe('row-1');
  });

  it('fails the next call with the scripted error and then accepts again', async () => {
    const provider = new FakeEmailProvider();
    provider.failNext(new EmailProviderError('transient', 'NETWORK', 'down'));

    await expect(
      provider.send(message, { idempotencyKey: 'a' }),
    ).rejects.toMatchObject({
      kind: 'transient',
      code: 'NETWORK',
    });
    await expect(
      provider.send(message, { idempotencyKey: 'a' }),
    ).resolves.toBeDefined();
    expect(provider.sent).toHaveLength(1);
  });

  it('keeps only the latest sends, so a long-running instance stays bounded', async () => {
    const provider = new FakeEmailProvider();

    for (let index = 0; index < 150; index += 1) {
      await provider.send(message, { idempotencyKey: `row-${index}` });
    }

    expect(provider.sent).toHaveLength(100);
    expect(provider.sent[0].options.idempotencyKey).toBe('row-50');
  });

  it('reset clears the record and any scripted failure', async () => {
    const provider = new FakeEmailProvider();
    provider.failNext(new EmailProviderError('permanent', 'X', 'no'));
    provider.reset();

    await expect(
      provider.send(message, { idempotencyKey: 'a' }),
    ).resolves.toBeDefined();
    expect(provider.sent).toHaveLength(1);
  });
});
