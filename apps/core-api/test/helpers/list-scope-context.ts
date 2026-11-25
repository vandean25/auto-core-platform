import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

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
