import { createHmac } from 'node:crypto';

export function continuityDigestForSignIn(
  secret: string,
  subject: string,
  authTimeSeconds: number,
): string {
  const material = `${subject}:${authTimeSeconds}`;
  return createHmac('sha256', secret).update(material).digest('hex');
}
