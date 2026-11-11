import { describe, expect, it } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { FakeScopeContextIdpAdapter } from './scope-context-idp.port.js';

describe('scope context IdP port (AUT-937)', () => {
  it('fails closed when the fake IdP is unreachable', async () => {
    const idp = new FakeScopeContextIdpAdapter();
    idp.setMode('unreachable');
    await expect(idp.verifyIdTokenWithRevocation('token')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
