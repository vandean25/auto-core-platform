import { UnauthorizedException } from '@nestjs/common';

export function extractBearerTokenFromHeader(
  authorizationHeader?: string,
): string {
  if (!authorizationHeader) {
    throw new UnauthorizedException('Missing Authorization header.');
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    throw new UnauthorizedException('Invalid Authorization header.');
  }

  return token;
}
