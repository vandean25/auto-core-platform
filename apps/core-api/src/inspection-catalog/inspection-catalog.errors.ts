import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export function catalogueNotConfigured() {
  return new UnprocessableEntityException({ code: 'NOT_CONFIGURED' });
}

export function unknownCode() {
  return new UnprocessableEntityException({ code: 'UNKNOWN_CODE' });
}

export function staleCatalog() {
  return new UnprocessableEntityException({ code: 'STALE_CATALOG' });
}

export function outOfScope() {
  return new UnprocessableEntityException({ code: 'OUT_OF_SCOPE' });
}

export function sourceConflict() {
  return new ConflictException({ code: 'SOURCE_CONFLICT' });
}

export function reviewRequired() {
  return new ConflictException({ code: 'REVIEW_REQUIRED' });
}

export function catalogueImportNotFound(importId: string) {
  return new NotFoundException(
    `Inspection catalogue import ${importId} not found`,
  );
}

export function catalogueImportForbidden() {
  return new ForbiddenException('Insufficient role for inspection catalogue');
}

export function workshopInspectionNotFound() {
  return new NotFoundException('Workshop inspection not found');
}
