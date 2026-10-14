import type {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  NotificationOutboxStatus,
} from '@prisma/client';
import type { WorkshopCommunicationStatus } from './dto/workshop-order-communications.dto.js';
import {
  buildWorkshopOrderCommunications,
  type EstimateApprovalRecord,
  type EstimateEmailRecord,
  WORKSHOP_COMMUNICATIONS_LIMIT,
} from './workshop-order-communications.js';

describe('buildWorkshopOrderCommunications', () => {
  const VERSION_1 = 'version-1';
  const VERSION_2 = 'version-2';
  const versionNumbers = new Map([
    [VERSION_1, 1],
    [VERSION_2, 2],
  ]);

  const email = (
    overrides: Partial<EstimateEmailRecord> = {},
  ): EstimateEmailRecord => ({
    id: 'outbox-a',
    status: 'ACCEPTED',
    createdAt: new Date('2026-10-10T08:00:00.000Z'),
    source_entity_id: VERSION_1,
    ...overrides,
  });

  const approval = (
    overrides: Partial<EstimateApprovalRecord> = {},
  ): EstimateApprovalRecord => ({
    id: 'approval-a',
    workshop_estimate_version_id: VERSION_1,
    channel: 'LINK',
    decision: 'APPROVED',
    decided_at: new Date('2026-10-11T09:30:00.000Z'),
    ...overrides,
  });

  const build = (
    emails: EstimateEmailRecord[] = [],
    approvals: EstimateApprovalRecord[] = [],
  ) => buildWorkshopOrderCommunications({ emails, approvals, versionNumbers });

  it('returns an empty list for an order with no estimate mail and no decision', () => {
    expect(build()).toEqual([]);
  });

  it('puts estimate emails and decisions in one list, newest first', () => {
    const result = build(
      [
        email({ id: 'outbox-a', createdAt: new Date('2026-10-10T08:00:00Z') }),
        email({
          id: 'outbox-b',
          status: 'PENDING',
          source_entity_id: VERSION_2,
          createdAt: new Date('2026-10-12T07:00:00Z'),
        }),
      ],
      [approval({ decided_at: new Date('2026-10-11T09:30:00Z') })],
    );

    expect(result.map((entry) => entry.id)).toEqual([
      'outbox-b',
      'approval-a',
      'outbox-a',
    ]);
  });

  it.each<[NotificationOutboxStatus, WorkshopCommunicationStatus]>([
    ['PENDING', 'QUEUED'],
    ['SENDING', 'QUEUED'],
    ['ACCEPTED', 'SENT'],
    ['FAILED', 'FAILED'],
    ['SUPPRESSED', 'SUPPRESSED'],
  ])('shows an email in %s state as %s', (status, expected) => {
    const [entry] = build([email({ status })]);

    expect(entry).toMatchObject({
      kind: 'ESTIMATE_EMAIL',
      channel: 'EMAIL',
      status: expected,
      decision: null,
    });
  });

  it('shows a customer decision with its channel and version, and no email state', () => {
    const [entry] = build(
      [],
      [
        approval({
          channel: 'ADVISOR_RECORDED',
          decision: 'DECLINED',
          workshop_estimate_version_id: VERSION_2,
          decided_at: new Date('2026-10-11T09:30:00.000Z'),
        }),
      ],
    );

    expect(entry).toEqual({
      id: 'approval-a',
      kind: 'ESTIMATE_APPROVAL',
      channel: 'ADVISOR_RECORDED',
      version: 2,
      occurred_at: '2026-10-11T09:30:00.000Z',
      status: null,
      decision: 'DECLINED',
    });
  });

  it('reads the version number of the version each entry is about, or null when it is unknown', () => {
    const result = build(
      [
        email({ id: 'outbox-v2', source_entity_id: VERSION_2 }),
        email({ id: 'outbox-gone', source_entity_id: 'deleted-version' }),
        email({ id: 'outbox-none', source_entity_id: null }),
      ],
      [approval({ workshop_estimate_version_id: VERSION_1 })],
    );

    const versionOf = (id: string) =>
      result.find((entry) => entry.id === id)?.version;
    expect(versionOf('outbox-v2')).toBe(2);
    expect(versionOf('outbox-gone')).toBeNull();
    expect(versionOf('outbox-none')).toBeNull();
    expect(versionOf('approval-a')).toBe(1);
  });

  it('carries no address, body, subject or typed name, even when the row it is built from holds them', () => {
    const rawEmail = {
      ...email(),
      recipient_email: 'kunde@example.test',
      subject: 'Ihr Kostenvoranschlag',
      body: 'Sehr geehrte Damen und Herren, anbei Ihr Angebot.',
    } as EstimateEmailRecord;
    const rawApproval = {
      ...approval(),
      recipient_email: 'kunde@example.test',
      typed_full_name: 'Max Mustermann',
      ip_address: '203.0.113.7',
      user_agent: 'Mozilla/5.0',
    } as EstimateApprovalRecord;

    const result = build([rawEmail], [rawApproval]);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('kunde@example.test');
    expect(serialized).not.toContain('Max Mustermann');
    expect(serialized).not.toContain('203.0.113.7');
    expect(serialized).not.toContain('Mozilla');
    expect(serialized).not.toContain('Sehr geehrte');
    expect(Object.keys(result[0]).sort()).toEqual([
      'channel',
      'decision',
      'id',
      'kind',
      'occurred_at',
      'status',
      'version',
    ]);
  });

  it(`returns at most ${WORKSHOP_COMMUNICATIONS_LIMIT} entries, keeping the newest`, () => {
    const emails = Array.from(
      { length: WORKSHOP_COMMUNICATIONS_LIMIT + 5 },
      (_, index) =>
        email({
          id: `outbox-${index}`,
          createdAt: new Date(Date.UTC(2026, 9, 1) + index * 60_000),
        }),
    );

    const result = build(emails);

    expect(result).toHaveLength(WORKSHOP_COMMUNICATIONS_LIMIT);
    expect(result[0].id).toBe(`outbox-${WORKSHOP_COMMUNICATIONS_LIMIT + 4}`);
    expect(result[result.length - 1].id).toBe('outbox-5');
  });

  it('orders two entries at the same instant by id, so two reads return the same order', () => {
    const at = new Date('2026-10-12T07:00:00.000Z');

    const result = build([
      email({ id: 'outbox-a', createdAt: at }),
      email({ id: 'outbox-b', createdAt: at }),
    ]);

    expect(result.map((entry) => entry.id)).toEqual(['outbox-b', 'outbox-a']);
  });

  it.each<[EstimateApprovalChannel, EstimateApprovalDecision]>([
    ['LINK', 'APPROVED'],
    ['LINK', 'DECLINED'],
    ['ADVISOR_RECORDED', 'APPROVED'],
  ])(
    'maps a %s %s decision to its own kind and channel',
    (channel, decision) => {
      const [entry] = build([], [approval({ channel, decision })]);

      expect(entry).toMatchObject({
        kind: 'ESTIMATE_APPROVAL',
        channel,
        decision,
        status: null,
      });
    },
  );
});
