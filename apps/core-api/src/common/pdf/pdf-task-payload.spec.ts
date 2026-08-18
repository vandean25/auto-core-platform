import { UnauthorizedException } from '@nestjs/common';
import {
  PDF_TASK_KINDS,
  signPdfTaskPayload,
  verifyPdfTaskPayload,
} from './pdf-task-payload';

describe('pdf-task-payload', () => {
  const secret = 'worker-secret';
  const claims = {
    kind: 'invoice' as const,
    resourceId: 'invoice-1',
    tenantId: 'tenant-abc',
  };

  it('round-trips a signed payload for every PDF task kind', () => {
    for (const kind of PDF_TASK_KINDS) {
      const signed = signPdfTaskPayload({ ...claims, kind }, secret);
      expect(verifyPdfTaskPayload(signed, secret)).toEqual({
        ...claims,
        kind,
      });
    }
  });

  it('rejects a payload whose tenantId was swapped after signing', () => {
    const signed = signPdfTaskPayload(claims, secret);

    expect(() =>
      verifyPdfTaskPayload({ ...signed, tenantId: 'tenant-other' }, secret),
    ).toThrow(UnauthorizedException);
  });

  it('rejects a payload signed with a different secret', () => {
    const signed = signPdfTaskPayload(claims, secret);

    expect(() => verifyPdfTaskPayload(signed, 'other-secret')).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a malformed payload', () => {
    expect(() => verifyPdfTaskPayload({}, secret)).toThrow(
      UnauthorizedException,
    );
    expect(() => verifyPdfTaskPayload(null, secret)).toThrow(
      UnauthorizedException,
    );
  });
});
