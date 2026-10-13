import { UnauthorizedException } from '@nestjs/common';
import { signPdfTaskPayload } from '../common/pdf/pdf-task-payload.js';
import {
  signNotificationTaskPayload,
  verifyNotificationTaskPayload,
} from './notification-task.payload.js';

const SECRET = 'worker-secret-test';
const claims = { outboxId: 'outbox-1', tenantId: 'tenant-1' };

describe('notification task payload signing', () => {
  it('verifies a payload signed with the same secret and returns its claims', () => {
    const signed = signNotificationTaskPayload(claims, SECRET);

    expect(verifyNotificationTaskPayload(signed, SECRET)).toEqual(claims);
  });

  it('rejects a tampered outbox id, a tampered tenant and a wrong secret', () => {
    const signed = signNotificationTaskPayload(claims, SECRET);

    expect(() =>
      verifyNotificationTaskPayload(
        { ...signed, outboxId: 'outbox-2' },
        SECRET,
      ),
    ).toThrow(UnauthorizedException);
    expect(() =>
      verifyNotificationTaskPayload(
        { ...signed, tenantId: 'tenant-2' },
        SECRET,
      ),
    ).toThrow(UnauthorizedException);
    expect(() => verifyNotificationTaskPayload(signed, 'other-secret')).toThrow(
      UnauthorizedException,
    );
  });

  it('does not accept a PDF task signature as a notification (kinds cannot be replayed)', () => {
    const pdf = signPdfTaskPayload(
      { kind: 'invoice', resourceId: 'outbox-1', tenantId: 'tenant-1' },
      SECRET,
    );

    expect(() =>
      verifyNotificationTaskPayload(
        { ...pdf, outboxId: pdf.resourceId },
        SECRET,
      ),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a payload without the expected fields', () => {
    expect(() =>
      verifyNotificationTaskPayload({ outboxId: 'x' }, SECRET),
    ).toThrow(UnauthorizedException);
    expect(() => verifyNotificationTaskPayload(undefined, SECRET)).toThrow(
      UnauthorizedException,
    );
  });
});
