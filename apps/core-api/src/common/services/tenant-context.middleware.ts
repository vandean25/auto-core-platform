import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TenantContextStorage } from './tenant-context.storage';

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(_request: Request, _response: Response, next: NextFunction) {
    TenantContextStorage.run(() => next());
  }
}