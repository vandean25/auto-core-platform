import {
  buildEmailColumns,
  type EmailDraft,
} from './notification-outbox.email-columns.js';

const draft: EmailDraft = {
  recipientEmail: 'kunde@example.at',
  subject: 'Auftrag Nr. 2026-0042',
  text: 'Guten Tag,',
  senderName: 'Werkstatt Nord',
};

describe('buildEmailColumns()', () => {
  it('returns null columns for an in-app row, which carries no message', () => {
    expect(buildEmailColumns(undefined)).toMatchObject({
      recipient_email: null,
      subject: null,
      body: null,
      body_sha256: null,
    });
  });

  it('accepts an apostrophe address, which is a valid customer address', () => {
    expect(
      buildEmailColumns({ ...draft, recipientEmail: "o'brien@example.at" }),
    ).toMatchObject({ recipient_email: "o'brien@example.at" });
  });

  it('refuses a recipient that names two addresses', () => {
    expect(() =>
      buildEmailColumns({
        ...draft,
        recipientEmail: 'kunde@example.at, victim@evil.example',
      }),
    ).toThrow('EMAIL recipient must be one plain address');
  });

  it('refuses a line separator or a tab in the subject or the sender name', () => {
    expect(() =>
      buildEmailColumns({ ...draft, subject: 'Auftrag Bcc: x' }),
    ).toThrow('EMAIL subject and sender name must be single-line');
    expect(() =>
      buildEmailColumns({ ...draft, senderName: 'Werkstatt\tNord' }),
    ).toThrow('EMAIL subject and sender name must be single-line');
  });

  it('refuses an empty or blank sender name, subject or text, which no notice can be sent with', () => {
    expect(() => buildEmailColumns({ ...draft, senderName: '   ' })).toThrow(
      'EMAIL sender name, subject and text must not be empty',
    );
    expect(() => buildEmailColumns({ ...draft, subject: '' })).toThrow(
      'EMAIL sender name, subject and text must not be empty',
    );
    expect(() => buildEmailColumns({ ...draft, text: '' })).toThrow(
      'EMAIL sender name, subject and text must not be empty',
    );
  });
});
