import {
  StandardSchemaValidationPipe,
  ValidationPipe,
  type PipeTransform,
} from '@nestjs/common';

export function createGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

export function createGlobalValidationPipes(): PipeTransform[] {
  return [new StandardSchemaValidationPipe(), createGlobalValidationPipe()];
}

