import { Catch, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { InvalidDomainEventConsumerTaskSignatureError } from './domain-event-consumer-task.payload.js';

@Catch(InvalidDomainEventConsumerTaskSignatureError)
export class DomainEventConsumerTaskSignatureFilter implements ExceptionFilter {
  catch(
    _exception: InvalidDomainEventConsumerTaskSignatureError,
    host: ArgumentsHost,
  ): void {
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(HttpStatus.NO_CONTENT)
      .end();
  }
}
