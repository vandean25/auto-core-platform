import {
  Injectable,
  type NestInterceptor,
  type ExecutionContext,
  type CallHandler,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Observable, from, firstValueFrom } from 'rxjs';
import type { Request, Response } from 'express';
import { DryRunService } from './dry-run.service.js';
import {
  DRY_RUN_SUPPORTED_KEY,
  DRY_RUN_REFUSED_KEY,
  DRY_RUN_NOT_SUPPORTED,
  DRY_RUN_HEADER,
} from './dry-run.constants.js';

interface HeaderSettableResponse {
  setHeader?(name: string, value: string): void;
  header?(name: string, value: string): void;
}

@Injectable()
export class DryRunInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly dryRunService: DryRunService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    const isDryRunRequested = this.isDryRunRequested(request);

    if (!isDryRunRequested) {
      return next.handle();
    }

    return from(this.handleDryRun(context, next));
  }

  private isDryRunRequested(request: Request | undefined): boolean {
    if (!request) return false;
    const queryVal = request.query?.dry_run;
    const headerVal =
      request.headers?.['x-dry-run'] ?? request.headers?.['X-Dry-Run'];

    return (
      queryVal === 'true' ||
      (queryVal as unknown) === true ||
      headerVal === 'true'
    );
  }

  private async handleDryRun(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<unknown> {
    const isRefused = Boolean(
      this.reflector.getAllAndOverride<unknown>(DRY_RUN_REFUSED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );

    const isSupported = Boolean(
      this.reflector.getAllAndOverride<boolean>(DRY_RUN_SUPPORTED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );

    if (isRefused || !isSupported) {
      throw new BadRequestException({
        message: DRY_RUN_NOT_SUPPORTED,
        code: DRY_RUN_NOT_SUPPORTED,
      });
    }

    const { result, wouldChange } =
      await this.dryRunService.executeInRollbackTransaction<unknown>(() =>
        firstValueFrom(next.handle()),
      );

    const http = context.switchToHttp();
    const response = http.getResponse<HeaderSettableResponse>();
    if (typeof response?.setHeader === 'function') {
      response.setHeader(DRY_RUN_HEADER, 'true');
    } else if (typeof response?.header === 'function') {
      response.header(DRY_RUN_HEADER, 'true');
    }

    if (
      result !== null &&
      typeof result === 'object' &&
      !Array.isArray(result)
    ) {
      return {
        ...(result as Record<string, unknown>),
        dry_run: true,
        would_change: wouldChange,
      };
    }

    return {
      data: result,
      dry_run: true,
      would_change: wouldChange,
    };
  }
}
