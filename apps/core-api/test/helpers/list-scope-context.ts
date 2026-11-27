import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SCOPE_CONTEXT_HEADER } from '../../src/auth/scope-context/scope-context.constants.js';

export function scopedListRequest(
  app: INestApplication,
  path: string,
  bearer: string,
  scopeContext: string,
) {
  return request(app.getHttpServer())
    .get(path)
    .set('Authorization', bearer)
    .set(SCOPE_CONTEXT_HEADER, scopeContext);
}

export async function mintListScopeContext(
  app: INestApplication,
  authToken: string,
): Promise<{ scopeContext: string; scopeContextDigest: string }> {
  const { body } = await request(app.getHttpServer())
    .post('/api/auth/scope-context')
    .set('Authorization', `Bearer ${authToken}`)
    .expect(200);
  return {
    scopeContext: body.scopeContext as string,
    scopeContextDigest: body.scopeContextDigest as string,
  };
}
