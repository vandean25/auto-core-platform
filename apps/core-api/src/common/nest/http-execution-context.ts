import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { Request, Response } from 'express';

/** When the context is not HTTP, forwards to the handler and returns the observable. */
export function passthroughUnlessHttpContext(
  context: ExecutionContext,
  next: CallHandler,
): Observable<unknown> | undefined {
  if (context.getType() !== 'http') {
    return next.handle();
  }
  return undefined;
}

export function getHttpRequestResponse(context: ExecutionContext): {
  request: Request;
  response: Response;
} {
  const http = context.switchToHttp();
  return {
    request: http.getRequest<Request>(),
    response: http.getResponse<Response>(),
  };
}
